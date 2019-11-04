//
// Requires
//
const electron = require("electron");
const url = require("url");
const path = require("path");
const fs = require('fs');
const ytdl = require('ytdl-core');
const NodeID3 = require('node-id3');
const ffmpeg = require('fluent-ffmpeg');
const request = require('request');
const downloadQueue = [];

//
// Variables & Constants
//
const { app, BrowserWindow, Menu, ipcMain } = electron;
let mainWindow, loadingScreen, downloadsWindow;

app.on('ready', () => {
    createMainWindow();
});

const mainMenuTemplate = [
    {
        label: "Quit",
        accelerator: process.platform == "darwin" ? "Command+Q" : "Ctrl+Q",
        role: "quit"
    }
]

if (process.platform == "darwin") {
    mainMenuTemplate.unshift({
        label: app.getName(),
        role: "TODO"
    })
}

if (process.env.NODE_ENV !== "production") {
    mainMenuTemplate.push(
        {
            label: "Geliştirici Seçenekleri",
            submenu: [
                {
                    label: "Geliştirici Penceresini Aç",
                    click(item, focusedWindow) {
                        focusedWindow.toggleDevTools();
                    }
                },
                {
                    label: "Yenile",
                    role: "reload"
                }
            ]
        }
    )
}
function createMainWindow() {
    const { width, height } = electron.screen.getPrimaryDisplay().workAreaSize
    mainWindow = new BrowserWindow({
        width: width,
        height: height,
        backgroundColor: '#ffffff',
        webPreferences: {
            nodeIntegration: true
        },
        autoHideMenuBar: true,
        icon: path.join(__dirname, "assets", 'app.ico'),
        frame: false,
        //show: false // => It breaks the Thumbar buttons :'(
        //fullscreen: true,
    });
    mainWindow.maximize();

    mainWindow.downloading = false;

    createLoadingScreen();

    mainWindow.loadURL("https://music.youtube.com/");

    mainWindow.on('close', function (event) {
        if (!app.isQuiting) {
            event.preventDefault();
            mainWindow.minimize();
        }

        return false;
    });

    mainWindow.setThumbarButtons([
        {
            tooltip: 'Previous Song',
            icon: path.join(__dirname, 'assets', 'img', 'previous.png'),
            flags: ["nobackground"],
            click() { mainWindow.webContents.send("music:previous") }
        },
        {
            tooltip: 'Play Song',
            icon: path.join(__dirname, "assets", 'img', 'play.png'),
            flags: ["nobackground"],
            click() { mainWindow.webContents.send("music:play-pause") }
        },
        {
            tooltip: 'Next Song',
            icon: path.join(__dirname, "assets", 'img', 'next.png'),
            flags: ["nobackground"],
            click() { mainWindow.webContents.send("music:next") }
        },
        {
            tooltip: 'Download',
            icon: path.join(__dirname, "assets", 'img', 'download.png'),
            flags: ["nobackground"],
            //flags: ["noninteractive"], // TODO If there is no music/video playing/paused, that will be noninteractive
            click() { mainWindow.webContents.send("music:download") }
        }
    ]);

    mainWindow.webContents.on('did-finish-load', async function () {
        console.log('# Main frame loaded.');

        await console.log('# Main js codes are loading...');
        await mainWindow.webContents.executeJavaScript(mainJS(), () => { })
        await console.log('# Main js codes loaded successfully!');

        if (loadingScreen) {
            loadingScreen.close();
        }

        mainWindow.focus();
        /* 
        if (!mainWindow.downloading) return;
        // The following codes belong to the downloads page.
        await console.log("# Downloads js codes are loading...");
        await mainWindow.webContents.executeJavaScript(downloadsJS(mainWindow.downloadsArray), () => { })
        await console.log("# Downloads js codes loaded successfully.");
        */
    });
    //let mainMenu = Menu.buildFromTemplate(mainMenuTemplate);
    //Menu.setApplicationMenu(mainMenu);

    ipcRequests();
}
function createLoadingScreen() {
    /// create a browser window
    loadingScreen = new BrowserWindow({
        parent: mainWindow,
        modal: true,
        resizable: false,
        frame: false,
        icon: path.join(__dirname, "assets", "app.ico"),
        transparent: true
    }
    );
    //loadingScreen.setIgnoreMouseEvents(true);
    loadingScreen.maximize();
    loadingScreen.focus();
    loadingScreen.loadURL(
        url.format({
            pathname: path.join(__dirname, "pages", "loading.html"),
            protocol: "file:",
            slashes: true
        })
    );
    loadingScreen.on('closed', () => {
        loadingScreen = null;
    });
    loadingScreen.webContents.on('did-finish-load', () => {
        loadingScreen.show();
    });
};
function createDownloadsWindow() {
    downloadsWindow = new BrowserWindow({
        webPreferences: {
            nodeIntegration: true
        },
        autoHideMenuBar: true,
        icon: path.join(__dirname, "assets", "app.ico"),
        title: "Downloaded songs"
    }
    );
    downloadsWindow.loadURL(
        url.format({
            pathname: path.join(__dirname, "pages", "downloads.html"),
            protocol: "file:",
            slashes: true
        })
    );
    downloadsWindow.focus();
    downloadsWindow.on('closed', () => {
        downloads = null;
    });
    downloadsWindow.webContents.on('did-finish-load', () => {
        downloadsWindow.show();
    });
};

function ipcRequests() {
    ipcMain.on("app:minimize", () => {
        mainWindow.minimize();
    });
    ipcMain.on("app:quit", () => {
        app.isQuiting = true;
        app.quit();
    });
    ipcMain.on("web:back", () => {
        if (mainWindow.webContents.canGoBack())
            mainWindow.webContents.goBack();
    });
    ipcMain.on("web:forward", () => {
        if (mainWindow.webContents.canGoForward())
            mainWindow.webContents.goForward();
    });
    ipcMain.on("music:progress", (err, data) => {
        let { value, max } = data;

        if (!mainWindow.downloading)
            mainWindow.setProgressBar(value / max);
    });
    ipcMain.on("web:tabButtonClick", (tabButtonName) => {
        switch (tabButtonName.toLowerCase()) {
            case "downloads":
                createDownloadsWindow();
                break;
            default:
                console.log("! Unknown tab button. Please set click event. (" + tabButtonName + ")")
                break;
        }
        return;
        let downloadsArray = [];

        let downloadsDir = path.join(__dirname, "dl");

        fs.readdir(downloadsDir, async (err, files) => {
            if (err) return console.log(err);

            await files.forEach(async file => {
                if (!file.endsWith(".mp3"))
                    return;

                await NodeID3.read(path.join(downloadsDir, file), function (err, tags) {
                    /*
                    tags: {
                      title: "Tomorrow",
                      artist: "Kevin Penkin",
                      image: {
                        mime: "jpeg",
                        type: {
                          id: 3,
                          name: "front cover"
                        },
                        description: String,
                        imageBuffer: Buffer
                      },
                      raw: {
                        TIT2: "Tomorrow",
                        TPE1: "Kevin Penkin",
                        APIC: Object (See above)
                      }
                    }
                    */
                    let downloadedSong = {
                        imgSrc: "",
                        title: tags.title,
                        artist: tags.artist
                    }
                    downloadsArray.push(downloadedSong);
                });
            });

            //mainWindow.downloading = await true;
            mainWindow.downloadsArray = await downloadsArray;
            //await mainWindow.loadURL("https://music.youtube.com/");
        });
    });
    ipcMain.on("music:download", (err, dataSong) => {
        const { videoURL, videoID, title, artist, album, imgURL, thumbURL, year } = dataSong;

        if (!videoID)
            videoID = ytdl.getURLVideoID(videoURL);

        if (!ytdl.validateID(videoID))
            return; // TODO Alert to webpage: "invalid youtube music/video"

        ytdl.getInfo("https://youtube.com/watch?v=" + videoID, {}, (err, info) => {
            
            let downloadPath = path.join(__dirname, "dl");

            fs.mkdir(downloadPath, () => {
                let stream = ytdl(videoID, {
                    quality: 'highestaudio',
                });

                dataSong["time"] = info.player_response.videoDetails.lengthSeconds;

                downloadQueue.push({data:dataSong,stream:stream})
            })

        });

    });
}

let queueBusy = false;
setInterval(() => {
    if (queueBusy || downloadQueue.length == 0)
        return

    queueBusy = true;
    let { data, stream } = downloadQueue[0]
    let { videoURL, videoID, title, artist, album, imgURL, thumbURL, year, time } = data;
    let fileName = `${artist} - ${title}`;
    let downloadPath = path.join(__dirname, "dl");
    let filePath = path.join(downloadPath, `${fileName}.mp3`);
    console.log("QUEUE:  DOWNLOADING => " + fileName);

    let img;
    console.log('Requesting cover photo..');
    request({
        url: imgURL,
        method: "get",
        encoding: null
    }, function (error, response, body) {
        if (error) {
            console.log("Error while getting cover photo.")
            console.log('Requesting thumbnail photo..');
            request({
                url: thumbURL,
                method: "get",
                encoding: null
            }, function (error, response, body) {
                if (error) {
                    console.error('image error: ', error);
                } else {
                    console.log('Response: StatusCode:', response && response.statusCode);
                    console.log('Response: Body: Length: %d. Is buffer: %s', body.length, (body instanceof Buffer));
                    //fs.writeFileSync('last.jpg', body);
                    img = body;
                }
            });
        } else {
            console.log('Response: StatusCode:', response && response.statusCode);
            console.log('Response: Body: Length: %d. Is buffer: %s', body.length, (body instanceof Buffer));
            //fs.writeFileSync('last.jpg', body);
            img = body;
        }
    });

    mainWindow.webContents.send("music:downloadProgress", data);
    mainWindow.setOverlayIcon(path.join(__dirname, "assets", 'img', "download.png"), 'Downloading...')
    let startTime = Date.now();
    ffmpeg(stream)
        .audioBitrate(256)
        .save(filePath)
        .on('progress', (p) => {
            console.log("progressing => " + fileName)
            let currentTime = new Date("0." + p.timemark.toString());
            let current = currentTime.getHours() * 3600 + currentTime.getMinutes() * 60 + currentTime.getSeconds();
            console.log(`${fileName} - downloaded: ${p.targetSize} kb - ${(current / time) * 100}%`);
            mainWindow.downloading = true;
            mainWindow.setProgressBar(current / time);
        })
        .on('end', (err, data2) => {
            mainWindow.webContents.send("music:downloadEnd", videoID);
            mainWindow.setOverlayIcon(null, ''); // Clear overlay icon.
            mainWindow.downloading = false;
            console.log("=> downloaded succesfully:   " + fileName)
            console.log(`\ndone in ${(Date.now() - startTime) / 1000}s`);
            let tags = {
                title: title,
                artist: artist,
                album: album,
                APIC: img,
                conductor: artist,
                remixArtist: artist,
                publisher: artist,
                year: year
            }

            if (NodeID3.write(tags, filePath))
                console.log("mp3 information included")
            else
                console.log("information include error")

            setTimeout(async () => {
                downloadQueue.shift()
                queueBusy = false;
            }, 5000);
        });
}, 1000);

function mainJS() {
    return `
    const electron = require("electron");
    const { ipcRenderer } = electron;

    //
    // Draggable Form
    //
    var draggableFormCSS = \`
        ytmusic-nav-bar[slot="nav-bar"] { 
            -webkit-app-region: drag;
        }
        #left-content {
            -webkit-app-region: no-drag;
        } 
        .tab-title {
            -webkit-app-region: no-drag;
        }
        .search-box {
            -webkit-app-region: no-drag;
        }
        .settings-button {
            -webkit-app-region: no-drag;
        }
    \`
    var styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = draggableFormCSS;
    document.head.appendChild(styleSheet);

    //
    // Progress of Current Music/Video
    //
    let intProgress = setInterval(() => {        
        let data = {
            value: document.querySelector('#progress-bar').value,
            max: document.querySelector('#progress-bar').getAttribute('aria-valuemax')
        };
        ipcRenderer.send("music:progress",data);
    }, 500);

    //
    // Custom Tab Buttons
    //
    createTabButton("Downloads");

    function createTabButton(name) {
        let a = document.createElement("ytmusic-pivot-bar-item-renderer");
        a.setAttribute("onclick","ipcRenderer.send('web:tabButtonClick',name);");
        a.setAttribute("class","style-scope ytmusic-pivot-bar-renderer");
        a.setAttribute("tab-id","FEmusic_" + name.toLowerCase());
        a.setAttribute("role","tab");
        let b = document.createElement("yt-formatted-string");
        b.setAttribute("class","tab-title style-scope ytmusic-pivot-bar-item-renderer");
        let c = document.createElement("span");
        c.setAttribute("class","style-scope yt-formatted-string");
        c.setAttribute("dir","auto");
        c.innerText = name;
        document.querySelector("ytmusic-pivot-bar-renderer").appendChild(a);
        a.appendChild(b);
        b.appendChild(c);
    }

    //
    // Buttons on page
    //
    let downloadedMusics = {};

    var intCurrentMusicInfo = setInterval(()=>{
        let currentTitle = document.querySelector(".title.style-scope.ytmusic-player-bar.complex-string").getAttribute("title");
        let currentArtist = document.querySelector(".byline.style-scope.ytmusic-player-bar.complex-string").getAttribute("title").split(" • ")[0];
        let currentVideoID = null;
        try {
            currentVideoID = document.querySelector(".ytp-title-link.yt-uix-sessionlink").getAttribute("href").split('v=')[1].split('&')[0];
        } catch (error) {
            currentVideoID = null;
        }
        let downloadButton = document.querySelector("mp3-download>paper-icon-button");
        if (!downloadedMusics[currentVideoID]) {
            // Not downloading
            downloadButton.setAttribute("src","https://image.flaticon.com/icons/svg/2200/2200178.svg");
            downloadButton.disabled = false;
        }
        if (downloadedMusics[currentVideoID] && downloadedMusics[currentVideoID].downloading) {
            // Downloading
            downloadButton.setAttribute("src","https://i.hizliresim.com/bv1j4G.gif");
            downloadButton.disabled = true;
        }
        if (downloadedMusics[currentVideoID] && !downloadedMusics[currentVideoID].downloading) {
            // Preparing
            downloadButton.setAttribute("src","https://loading.io/spinners/message/lg.messenger-typing-preloader.gif");
            downloadButton.disabled = true;
        } 

        // TODO müzik alta gönderilince bozuluyor indirilirken gösteriyo. preparing takılı kalıyo müzikte. delete olmamış
    },1000);

    ipcRenderer.on("music:downloadProgress", (err, data) => {
        downloadedMusics[data.videoID] = {downloading:true,title:data.title,artist:data.artist};
    });
    ipcRenderer.on("music:downloadEnd", (err, videoID)=>{
        downloadedMusics[videoID] = undefined;

        // TODO Download completed notification.
    });
    function downloadOnClick() {
        let info = document.querySelector(".byline.style-scope.ytmusic-player-bar.complex-string").getAttribute("title").split(" • ");
        let title = document.querySelector(".title.style-scope.ytmusic-player-bar.complex-string").getAttribute("title");
        let artist = info[0];
        let album = (info[1] == title) ? (info[1] + " - Single") : info[1];
        let year = info[2];
        let imgURL = document.querySelector("#thumbnail>#img").getAttribute("src");
        let thumbURL = document.querySelector(".image.style-scope.ytmusic-player-bar").getAttribute("src");
        let currentVideoID = null;
        try {
            currentVideoID = document.querySelector(".ytp-title-link.yt-uix-sessionlink").getAttribute("href").split('v=')[1].split('&')[0];
        } catch (error) {
            currentVideoID = null;
        }
        console.log("download starting: " + currentVideoID)
        downloadedMusics[currentVideoID] = {downloading:false,title:title,artist:artist};

        let data = {
            videoURL: window.location.href,
            videoID: currentVideoID,
            title: title,
            artist: artist,
            album: album,
            imgURL: imgURL,
            thumbURL: thumbURL,
            year: year
        };
        console.log(data)
        ipcRenderer.send("music:download",data);
    }
    let mp3Download = document.createElement('mp3-download');
    mp3Download.innerHTML = \`<paper-icon-button aria-label="Download Music" src="https://image.flaticon.com/icons/svg/2200/2200178.svg" onclick="downloadOnClick()">\`
    
    let webBack = document.createElement('web-back');
    webBack.innerHTML = \`<ytmusic-settings-button class="settings-button style-scope ytmusic-nav-bar yt-simple-endpoint style-scope ytmusic-nav-bar"><paper-icon-button aria-haspopup="true" class="style-scope ytmusic-settings-button" onclick="ipcRenderer.send('web:back')" role="button" tabindex="0" aria-disabled="false" aria-label="Previous page" src="https://image.flaticon.com/icons/svg/137/137623.svg"></paper-icon-button></ytmusic-settings-button>\`;
    let webForward = document.createElement('web-forward');
    webForward.innerHTML = \`<ytmusic-settings-button class="settings-button style-scope ytmusic-nav-bar yt-simple-endpoint style-scope ytmusic-nav-bar"><paper-icon-button aria-haspopup="true" class="style-scope ytmusic-settings-button" onclick="ipcRenderer.send('web:forward')" role="button" tabindex="0" aria-disabled="false" aria-label="Next page" src="https://image.flaticon.com/icons/svg/137/137624.svg"></paper-icon-button></ytmusic-settings-button>\`;
    
    let appMinimize = document.createElement('app-minimize');
    appMinimize.innerHTML = \`<ytmusic-settings-button class="settings-button style-scope ytmusic-nav-bar"><paper-icon-button aria-haspopup="true" class="style-scope ytmusic-settings-button" onclick="ipcRenderer.send('app:minimize')" role="button" tabindex="0" aria-disabled="false" aria-label="Minimize app" src="https://image.flaticon.com/icons/svg/1251/1251480.svg"></paper-icon-button></ytmusic-settings-button>\`;
    let appQuit = document.createElement('app-quit');
    appQuit.innerHTML = \`<ytmusic-settings-button class="settings-button style-scope ytmusic-nav-bar"><paper-icon-button aria-haspopup="true" class="style-scope ytmusic-settings-button" onclick="ipcRenderer.send('app:quit')" role="button" tabindex="0" aria-disabled="false" aria-label="Quit app" src="https://image.flaticon.com/icons/svg/148/148766.svg"></paper-icon-button></ytmusic-settings-button>\`;
    
    document.getElementById('like-button-renderer').appendChild(mp3Download);
    document.getElementById('left-content').appendChild(webBack);
    document.getElementById('left-content').appendChild(webForward);
    document.getElementById('right-content').appendChild(appMinimize);
    document.getElementById('right-content').appendChild(appQuit);
    
    //
    // Buttons on Task Bar
    //
    let previousBtn = document.getElementsByClassName('previous-button style-scope ytmusic-player-bar')[0];
    let playPauseBtn = document.getElementById('play-pause-button');
    let nextBtn = document.getElementsByClassName('next-button style-scope ytmusic-player-bar')[0];
    let downloadBtn = document.getElementById('mp3-download');

    ipcRenderer.on("music:previous", () => {
        previousBtn.click();
    });
    ipcRenderer.on("music:play-pause", () => {
        playPauseBtn.click();
    });
    ipcRenderer.on("music:next", () => {
        nextBtn.click();
    });
    ipcRenderer.on("music:download", () => {
        downloadBtn.click();
    });
    `
}
function downloadsJS(downloads = []) {
    console.log(downloads)
    let totalJS = [];
    let totalJS2 = [];
    totalJS.push(`
    document.querySelector("html").setAttribute("class","no-focus-outline")
    document.body.setAttribute("style","overflow: hidden;");
    document.querySelector("#layout").setAttribute("player-visible_","");
    document.querySelector("#layout").setAttribute("show-fullscreen-controls_","");
    document.querySelector("#layout").setAttribute("player-page-open_","");
    document.querySelector("#player-page").setAttribute("style","visibility: visible;");
    document.querySelector("#content").setAttribute("style","visibility: hidden;");
    document.querySelector("#content").innerHTML = "";
    document.querySelector("ytmusic-pivot-bar-item-renderer").setAttribute("class","style-scope ytmusic-pivot-bar-renderer");
    a.setAttribute("class","style-scope ytmusic-pivot-bar-renderer iron-selected");
    `);

    downloads.forEach(song => {
        const { imgSrc, title, artist } = song;
        totalJS.push(`
        queue = document.createElement("ytmusic-player-queue-item");
        queue.setAttribute("class","style-scope ytmusic-player-queue");
        queue.setAttribute("play-button-state","default");
        queue.setAttribute("style","--ytmusic-player-queue-item-thumbnail-size:32px;");
        leftItems = document.createElement("div");
        leftItems.setAttribute("class","left-items style-scope ytmusic-player-queue-item");
        thumbnail = document.createElement("yt-img-shadow");
        thumbnail.setAttribute("class","thumbnail style-scope ytmusic-player-queue-item no-transition");
        thumbnail.setAttribute("object-fit","CONTAIN");
        thumbnail.setAttribute("style","background-color: transparent;");
        thumbnail.setAttribute("loaded","");
        img = document.createElement("img");
        img.setAttribute("id","img");
        img.setAttribute("class","style-scope yt-img-shadow");
        img.setAttribute("alt","");
        img.setAttribute("width","32");
        img.setAttribute("src","` + imgSrc + `");

        songInfoDiv = document.createElement("div");
        songInfoDiv.setAttribute("class","song-info style-scope ytmusic-player-queue-item");

            songTitle = document.createElement("yt-formatted-string");
            songTitle.setAttribute("class","song-title style-scope ytmusic-player-queue-item complex-string");

            bylineWrapper = document.createElement("div");
            bylineWrapper.setAttribute("class","byline-wrapper style-scope ytmusic-player-queue-item");
                byline = document.createElement("yt-formatted-string");
                byline.setAttribute("class","byline style-scope ytmusic-player-queue-item complex-string");

        document.querySelectorAll("#contents.style-scope.ytmusic-player-queue")[1].innerHTML = "";
        document.querySelectorAll("#contents.style-scope.ytmusic-player-queue")[1].appendChild(queue);
            queue.appendChild(leftItems);
                leftItems.appendChild(thumbnail);
                    thumbnail.innerHTML = "";
                    thumbnail.appendChild(img);
            queue.appendChild(songInfoDiv);
                songInfoDiv.appendChild(songTitle);
                    songTitle.innerHTML = "` + title + `";
                songInfoDiv.appendChild(bylineWrapper);
                    bylineWrapper.appendChild(byline);
                        byline.innerHTML = "` + artist + `";
        `);
    });

    return (totalJS.join("\n"));
}