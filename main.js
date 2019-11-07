// Requires
const electron = require("electron");
const url = require("url");
const path = require("path");
const fs = require('fs');
const ytdl = require('ytdl-core');
const NodeID3 = require('node-id3');
const ffmpeg = require('fluent-ffmpeg');
const request = require('request');
const getMP3Duration = require('get-mp3-duration');
const adBlocker = require('@cliqz/adblocker-electron');
const crossFetch = require('cross-fetch');
const remote = require('remote-file-size')
const requestProgress = require('request-progress');
const bytes = require('bytes');
const exec = require('child_process').exec;

// Main Constants
const { app, BrowserWindow, Menu, ipcMain, session } = electron;
const { ElectronBlocker } = adBlocker;
const { fetch } = crossFetch;

// Other Variables & Constants
let mainWindow, loadingScreen, downloadsWindow, updateWindow;
const downloadQueue = [];
var updateURL = 'https://www.dropbox.com/s/4ixv0yk09g37lw6/app.asar?dl=1'//http
var updateExeURL = 'https://www.dropbox.com/s/dqlw55gpx837n7r/youtubemusic-desktop-update.exe?dl=1'//http

// UPDATER & STARTER
app.on('ready', () => {
    updateWindow = new BrowserWindow({
        webPreferences: {
            nodeIntegration: true
        },
        autoHideMenuBar: true,
        icon: path.join(__dirname, "app", "app.ico")
    });
    updateWindow.loadURL(
        url.format({
            pathname: path.join(__dirname, "app", "pages", "update.html"),
            protocol: "file:",
            slashes: true
        })
    );
    updateWindow.focus();
    updateWindow.on('closed', () => {
        updateWindow = null;
    });
    updateWindow.webContents.on('did-finish-load', () => {

    });
    remote(updateURL, function (err, o) {
        if (err) {
            console.log(err);
            createMainWindow();
        }

        var mainPath = path.join(process.resourcesPath, "app.asar")
        if (!fs.existsSync(mainPath))
            createMainWindow();
            
        const stats = fs.statSync(mainPath);
        const fileSizeInBytes = stats.size;

        console.log(o)
        console.log(fileSizeInBytes)

        if (o == fileSizeInBytes) {
            createMainWindow();
        } else {
            // UPDATE
            updateWindow.webContents.send("Download starting... (" + bytes(fileSizeInBytes, { unitSeparator: ' ' }) + ")")
            console.log("Download starting... (" + bytes(fileSizeInBytes, { unitSeparator: ' ' }) + ")")
            requestProgress(request(updateExeURL))
                .pipe(fs.createWriteStream(path.join(process.resourcesPath,"Update.exe")))

            requestProgress(request(updateURL))
                .on('progress', state => {
                    console.log(bytes(state.size.transferred))
                    updateWindow.webContents.send("status:update", state)
                    /*
                    {
                        time: { elapsed: 46.072, remaining: 30.626 },
                        speed: 164280.27869421773,
                        percent: 0.600692762619517,
                        size: { total: 12599987, transferred: 7568721 }
                    }
                    */

                })
                .on('error', err => {
                    console.log(err)
                    updateWindow.webContents.send("status:update", err)
                })
                .on('end', () => {
                    console.log("Updating...")
                    updateWindow.webContents.send("status:update", "Updating...")
                    
                    exec('start "" "' + path.join(process.resourcesPath,"Update.exe")+'"')
                })
                .pipe(fs.createWriteStream(mainPath.replace("app.asar","app.update")))
        }

    })
});


// ADBLOCKER
ElectronBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) => {
    blocker.enableBlockingInSession(session.defaultSession);
    blocker.on('request-blocked', (request) => {
        console.log('blocked', request.tabId, request.url);
    });

    blocker.on('request-redirected', (request) => {
        console.log('redirected', request.tabId, request.url);
    });

    blocker.on('request-whitelisted', (request) => {
        console.log('whitelisted', request.tabId, request.url);
    });

    blocker.on('csp-injected', (request) => {
        console.log('csp', request.url);
    });

    blocker.on('script-injected', (script, url) => {
        console.log('script', script.length, url);
    });

    blocker.on('style-injected', (style, url) => {
        console.log('style', style.length, url);
    });
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
        icon: path.join(__dirname, 'app', 'app.ico'),
        frame: false,
        //show: false // => It breaks the Thumbar buttons :'(
        //fullscreen: true,
    });
    mainWindow.maximize();

    mainWindow.downloading = false;
    mainWindow.downloads = false;

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
            icon: path.join(__dirname, 'app', 'img', 'previous.png'),
            flags: ["nobackground"],
            click() { mainWindow.webContents.send("music:previous") }
        },
        {
            tooltip: 'Play Song',
            icon: path.join(__dirname, "app", 'img', 'play.png'),
            flags: ["nobackground"],
            click() { mainWindow.webContents.send("music:play-pause") }
        },
        {
            tooltip: 'Next Song',
            icon: path.join(__dirname, "app", 'img', 'next.png'),
            flags: ["nobackground"],
            click() { mainWindow.webContents.send("music:next") }
        },
        {
            tooltip: 'Download',
            icon: path.join(__dirname, "app", 'img', 'download.png'),
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

        if (!mainWindow.downloads) return;
        // The following codes belong to the downloads page.
        await console.log("# Downloads js codes are loading...");
        await mainWindow.webContents.executeJavaScript(downloadsJS(mainWindow.downloadsArray), () => { })
        mainWindow.downloads = await false;
        await console.log("# Downloads js codes loaded successfully.");

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
        icon: path.join(__dirname, "app", "app.ico"),
        transparent: true
    }
    );
    //loadingScreen.setIgnoreMouseEvents(true);
    loadingScreen.maximize();
    loadingScreen.focus();
    loadingScreen.loadURL(
        url.format({
            pathname: path.join(__dirname, "app", "pages", "loading.html"),
            protocol: "file:",
            slashes: true
        })
    );
    loadingScreen.on('closed', () => {
        loadingScreen = null;
    });
    loadingScreen.webContents.on('did-finish-load', () => {
        if (updateWindow) {
            updateWindow.close();
        }
        loadingScreen.show();
    });
};
function createDownloadsWindow() {
    downloadsWindow = new BrowserWindow({
        webPreferences: {
            nodeIntegration: true
        },
        autoHideMenuBar: true,
        icon: path.join(__dirname, "app", "app.ico"),
        title: "Downloaded songs"
    }
    );
    downloadsWindow.loadURL(
        url.format({
            pathname: path.join(__dirname, "app", "pages", "downloads.html"),
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
    ipcMain.on("web:tabButtonClick", (err, tabButtonName) => {
        switch (tabButtonName.toLowerCase()) {
            case "downloads":
                //createDownloadsWindow();
                let downloadsArray = [];
                /*
                [
                    {title:"Tonti",artist:"Talha Osmanoğlu",album:"Tonti - Single",time:141,explicit:false,imgURL:"https://lh3.googleusercontent.com/z3zz_9Eyf_71J4-0WsBW5pwHy_5sqzFJF6Aky-gv4Z6EsgVZk6sYnzghT6jYr1kwy_9TU7rvet32Tj8=w60-h60-l90-rj"},
                    {title:"Boş İş",artist:"Talha Osmanoğlu",album:"Boş İş - Single",time:543,explicit:true,imgURL:"https://lh3.googleusercontent.com/z3zz_9Eyf_71J4-0WsBW5pwHy_5sqzFJF6Aky-gv4Z6EsgVZk6sYnzghT6jYr1kwy_9TU7rvet32Tj8=w60-h60-l90-rj"}
                ]
                */
                let downloadsDir = path.join(process.resourcesPath, "dl");

                fs.readdir(downloadsDir, async (err, files) => {
                    if (err) return console.log(err);
                    await files.forEach(async file => {
                        if (!file.endsWith(".mp3"))
                            return;
                        await NodeID3.read(path.join(downloadsDir, file), async function (err, tags) {
                            let durationB = false;
                            let buffer, duration;


                            let comment;
                            try {
                                comment = JSON.parse(tags.comment.text)
                            } catch (error) {
                                comment = {}
                            }

                            if (!comment.time)
                                durationB = true;

                            if (durationB) {
                                buffer = await fs.readFileSync(path.join(downloadsDir, file));
                                duration = await getMP3Duration(buffer) / 1000;
                                let newStringDict = comment;
                                newStringDict.time = duration;
                                if (NodeID3.update({ comment: { language: "eng", text: JSON.stringify(newStringDict) } }, path.join(downloadsDir, file)))
                                    console.log("mp3 information updated")
                                else
                                    console.log("information update error")
                            }


                            let downloadedSong = {
                                title: tags.title,
                                artist: tags.artist,
                                album: tags.album,
                                time: durationB ? duration : comment.time,
                                explicit: comment.explicit,
                                imgURL: tags.comment ? comment.imgURL : null,
                            }
                            downloadsArray.push(downloadedSong);
                        });
                    });
                    mainWindow.downloads = await true;
                    mainWindow.downloadsArray = await downloadsArray;
                    await mainWindow.loadURL("https://music.youtube.com/playlist?list=TLGGc8mFCqGb91UwNTExMjAxOQ");
                });
                break;
            default:
                console.log("! Unknown tab button. Please set click event. (" + tabButtonName + ")")
                break;
        }
        return;

    });
    ipcMain.on("music:download", (err, dataSong) => {
        const { videoURL, videoID, title, artist, album, imgURL, thumbURL, year } = dataSong;

        if (!videoID)
            videoID = ytdl.getURLVideoID(videoURL);

        if (!ytdl.validateID(videoID))
            return; // TODO Alert to webpage: "invalid youtube music/video"

        ytdl.getInfo("https://youtube.com/watch?v=" + videoID, {}, (err, info) => {

            let downloadPath = path.join(process.resourcesPath, "dl");

            fs.mkdir(downloadPath, () => {
                let stream = ytdl(videoID, {
                    quality: 'highestaudio',
                });

                dataSong["time"] = info.player_response.videoDetails.lengthSeconds;

                downloadQueue.push({ data: dataSong, stream: stream })
            })

        });

    });
}

// Download queue
let queueBusy = false;
setInterval(() => {
    if (queueBusy || downloadQueue.length == 0)
        return

    queueBusy = true;
    let { data, stream } = downloadQueue[0]
    let { videoURL, videoID, title, artist, album, imgURL, thumbURL, year, time, explicit } = data;
    let fileName = `${artist} - ${title}`;
    let downloadPath = path.join(process.resourcesPath, "dl");
    let filePath = path.join(downloadPath, `${fileName}.mp3`);
    console.log("QUEUE:  DOWNLOADING => " + fileName);

    let lastImgURL;
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
                    fs.writeFileSync(path.join(process.resourcesPath, "last.png"), body);
                    mainWindow.setOverlayIcon(path.join(process.resourcesPath, "last.png"), 'Downloading...')
                    lastImgURL = thumbURL;
                    img = body;
                }
            });
        } else {
            console.log('Response: StatusCode:', response && response.statusCode);
            console.log('Response: Body: Length: %d. Is buffer: %s', body.length, (body instanceof Buffer));
            fs.writeFileSync(path.join(process.resourcesPath, "last.png"), body);
            mainWindow.setOverlayIcon(path.join(process.resourcesPath, "last.png"), 'Downloading...')
            lastImgURL = imgURL;
            img = body;
        }
    });

    mainWindow.webContents.send("music:downloadProgress", data);
    mainWindow.setOverlayIcon(path.join(__dirname, "app", 'img', "download.png"), 'Downloading...')
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
                year: year,
                comment: {
                    language: "eng",
                    text: JSON.stringify({ time: time, imgURL: lastImgURL, explicit: explicit })
                },
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

    // Auto continue to play music when it asks
    // TODO add selector for user.
    let intContinueToPlay = setInterval(()=>{
        document.querySelector("paper-button#button").click();
    },1000);
    ipcRenderer.on("music:setContinueToPlay",bool) {
        clearInterval(intContinueToPlay);
        if (bool) {
            intContinueToPlay = setInterval(()=>{
                document.querySelector("paper-button#button").click();
            },1000);
        }
    }

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
        a.setAttribute("onclick","ipcRenderer.send('web:tabButtonClick','" + name + "');");
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
        let explicit = document.querySelector("#badges.ytmusic-player-bar").childElementCount;
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
            year: year,
            explicit: explicit
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
function downloadsJS(downloadedSongs = []) {
    return `
    document.querySelectorAll("ytmusic-pivot-bar-item-renderer.style-scope.ytmusic-pivot-bar-renderer")[3].setAttribute("class","style-scope ytmusic-pivot-bar-renderer iron-selected")

    downloadedSongs = ${JSON.stringify(downloadedSongs)};

    document.querySelector("#contents").innerHTML = \`
    <ytmusic-item-section-renderer class="style-scope ytmusic-section-list-renderer fullbleed" has-item-section-tabbed-header-renderer_="">
        <div class="style-scope ytmusic-item-section-renderer" style="height: var(--ytmusic-nav-bar-height); margin-top: calc(-1 * var(--ytmusic-nav-bar-height));"></div><div id="header" class="style-scope ytmusic-item-section-renderer"><ytmusic-item-section-tabbed-header-renderer class="style-scope ytmusic-item-section-renderer" role="tablist" tabindex="0">
        <div id="items" class="scroller scroller-on-hover style-scope ytmusic-item-section-tabbed-header-renderer"><ytmusic-item-section-tab-renderer class="style-scope ytmusic-item-section-tabbed-header-renderer" selected="false" role="tab">
        <yt-formatted-string class="tab style-scope ytmusic-item-section-tab-renderer"><span dir="auto" class="style-scope yt-formatted-string">Playlists</span></yt-formatted-string>
      </ytmusic-item-section-tab-renderer><ytmusic-item-section-tab-renderer class="style-scope ytmusic-item-section-tabbed-header-renderer" selected="false" role="tab">
        <yt-formatted-string class="tab style-scope ytmusic-item-section-tab-renderer"><span dir="auto" class="style-scope yt-formatted-string">Albums</span></yt-formatted-string>
      </ytmusic-item-section-tab-renderer><ytmusic-item-section-tab-renderer class="style-scope ytmusic-item-section-tabbed-header-renderer iron-selected" selected="true" role="tab" aria-selected="true" tabindex="0">
        <yt-formatted-string class="tab style-scope ytmusic-item-section-tab-renderer"><span dir="auto" class="style-scope yt-formatted-string">Liked songs</span></yt-formatted-string>
      </ytmusic-item-section-tab-renderer><ytmusic-item-section-tab-renderer class="style-scope ytmusic-item-section-tabbed-header-renderer" selected="false" role="tab">
        <yt-formatted-string class="tab style-scope ytmusic-item-section-tab-renderer"><span dir="auto" class="style-scope yt-formatted-string">Artists</span></yt-formatted-string>
      </ytmusic-item-section-tab-renderer></div>
        <div id="end-items" class="style-scope ytmusic-item-section-tabbed-header-renderer"></div>
      </ytmusic-item-section-tabbed-header-renderer></div>
        <div id="items" class="style-scope ytmusic-item-section-renderer"><ytmusic-shelf-renderer class="style-scope ytmusic-item-section-renderer">
        <dom-if class="style-scope ytmusic-shelf-renderer"><template is="dom-if"></template></dom-if>
        <div id="contents" class="style-scope ytmusic-shelf-renderer"><ytmusic-responsive-list-item-renderer class="style-scope ytmusic-shelf-renderer" should-render-subtitle-separators_="" num-flex-columns="3" is-interactive="" has-thumbnail-overlay_="" play-button-state="default">
        <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>
        <div class="left-items style-scope ytmusic-responsive-list-item-renderer">
            <ytmusic-thumbnail-renderer class="thumbnail style-scope ytmusic-responsive-list-item-renderer" image-width="56" thumbnail-crop_="MUSIC_THUMBNAIL_CROP_UNSPECIFIED">
        <yt-img-shadow id="image" class="image style-scope ytmusic-thumbnail-renderer no-transition" object-fit="CONTAIN" style="background-color: transparent;" loaded=""><img id="img" class="style-scope yt-img-shadow" alt="" width="56" src="https://lh3.googleusercontent.com/bsix6xYkPGb-ICH4MGhG1C6M2KrXASRA_Aa2cGnptRYO9b8jtvEar3gGDmwkfcESbDxvNVPK8w_KmhBh=w60-h60-l90-rj"></yt-img-shadow>
      </ytmusic-thumbnail-renderer>
          <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>
          <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>
          <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>
            <ytmusic-item-thumbnail-overlay-renderer class="thumbnail-overlay style-scope ytmusic-responsive-list-item-renderer" indexed="" content-position="MUSIC_ITEM_THUMBNAIL_OVERLAY_CONTENT_POSITION_CENTERED" display-style="MUSIC_ITEM_THUMBNAIL_OVERLAY_DISPLAY_STYLE_PERSISTENT" play-button-state="default" animate-transitions_="">
        <ytmusic-background-overlay-renderer id="background" class="style-scope ytmusic-item-thumbnail-overlay-renderer" style="--ytmusic-background-overlay-background:linear-gradient(rgba(0,0,0,0.8),rgba(0,0,0,0.8));">
      </ytmusic-background-overlay-renderer>
        <div id="content" class="style-scope ytmusic-item-thumbnail-overlay-renderer">
            <ytmusic-play-button-renderer id="play-button" class="style-scope ytmusic-item-thumbnail-overlay-renderer" role="button" tabindex="0" animated="" state="default" aria-label="Play Komedi v Dram (feat. Ceza)" size="MUSIC_PLAY_BUTTON_SIZE_SMALL" elevation="1" aria-disabled="false" style="--ytmusic-play-button-icon-color:rgba(255,255,255,1); --ytmusic-play-button-icon-loading-color:rgba(0,0,0,0); --ytmusic-play-button-background-color:rgba(0,0,0,0); --ytmusic-play-button-active-background-color:rgba(0,0,0,0); --ytmusic-play-button-loading-indicator-color:rgba(255,0,0,1); --ytmusic-play-button-active-scale-factor:1;">
        <div class="content-wrapper style-scope ytmusic-play-button-renderer">
          <yt-icon class="icon style-scope ytmusic-play-button-renderer"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope yt-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope yt-icon">
            <path d="M8 5v14l11-7z" class="style-scope yt-icon"></path>
          </g></svg>
      </yt-icon>
          <paper-spinner-lite class="loading-indicator style-scope ytmusic-play-button-renderer" hidden="" aria-hidden="true"><!--css-build:shady--><div id="spinnerContainer" class="  style-scope paper-spinner-lite"><div class="spinner-layer style-scope paper-spinner-lite"><div class="circle-clipper left style-scope paper-spinner-lite"><div class="circle style-scope paper-spinner-lite"></div></div><div class="circle-clipper right style-scope paper-spinner-lite"><div class="circle style-scope paper-spinner-lite"></div></div></div></div></paper-spinner-lite>
        </div>
      </ytmusic-play-button-renderer>
          <dom-if class="style-scope ytmusic-item-thumbnail-overlay-renderer"><template is="dom-if"></template></dom-if>
        </div>
      </ytmusic-item-thumbnail-overlay-renderer>
          <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>
          <yt-icon class="error style-scope ytmusic-responsive-list-item-renderer" icon="error"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope yt-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope yt-icon">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" class="style-scope yt-icon"></path>
          </g></svg>
      </yt-icon>
        </div>
        <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>
        <div class="flex-columns style-scope ytmusic-responsive-list-item-renderer">
          <div class="title-column style-scope ytmusic-responsive-list-item-renderer">
            <yt-formatted-string class="title style-scope ytmusic-responsive-list-item-renderer complex-string" ellipsis-truncate="" respect-html-dir="" title="Komedi v Dram (feat. Ceza)"><span dir="auto" class="style-scope yt-formatted-string">Komedi v Dram (feat. Ceza)</span></yt-formatted-string>
            <div id="columnar-layout-badges" class="badges style-scope ytmusic-responsive-list-item-renderer"></div>
          </div>
          <div id="stacked-layout-badges" class="badges style-scope ytmusic-responsive-list-item-renderer"></div>
          <div class="secondary-flex-columns style-scope ytmusic-responsive-list-item-renderer">
              <yt-formatted-string class="flex-column style-scope ytmusic-responsive-list-item-renderer complex-string" ellipsis-truncate="" respect-html-dir="" title="Sayedar &amp; Önder Şahin"><a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="channel/UC_qFmiU61gcs9Sf5UAmcBSw" dir="auto">Sayedar</a><span dir="auto" class="style-scope yt-formatted-string"> &amp; </span><a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="channel/UCkncYAanu8p-pT9FsXxx6Nw" dir="auto">Önder Şahin</a></yt-formatted-string>
              <yt-formatted-string class="flex-column style-scope ytmusic-responsive-list-item-renderer complex-string" ellipsis-truncate="" respect-html-dir="" has-link-only_="" title="Gölge Boksu"><a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="browse/MPREb_hRgic3cR82U" dir="auto">Gölge Boksu</a></yt-formatted-string>
            <dom-repeat as="column" class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-repeat"></template></dom-repeat>
          </div>
        </div>
        <ytmusic-menu-renderer class="menu style-scope ytmusic-responsive-list-item-renderer">
        <div id="top-level-buttons" class="style-scope ytmusic-menu-renderer"><ytmusic-like-button-renderer class="style-scope ytmusic-menu-renderer" like-status="LIKE">
        <paper-icon-button class="dislike style-scope ytmusic-like-button-renderer" title="Dislike" aria-label="Dislike" role="button" tabindex="0" aria-disabled="false" aria-pressed="false"><!--css-build:shady--><iron-icon id="icon" class="style-scope paper-icon-button"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope iron-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope iron-icon">
            <path d="M14.9 3H6c-.8 0-1.5.5-1.8 1.2l-3 7.3c-.1.2-.2.4-.2.7v2c0 1.1.9 2 2 2h6.3l-1 4.7v.3c0 .4.2.8.4 1.1.6.7 1.5.7 2.1.1l5.5-5.7c.4-.4.6-.9.6-1.4V5c0-1.1-.9-2-2-2zm-.2 12.6l-3.5 3.6c-.2.2-.5 0-.4-.2l1-4.6H4c-.6 0-1-.5-1-1v-1.1l2.7-6.6c.2-.5.6-.7 1-.7H14c.5 0 1 .5 1 1v8.8c-.1.3-.2.6-.3.8zM19 3h4v12h-4V3z" class="style-scope iron-icon"></path>
          </g></svg><!--css-build:shady-->
    </iron-icon></paper-icon-button>
        <paper-icon-button class="like style-scope ytmusic-like-button-renderer" title="Like" aria-label="Like" role="button" tabindex="0" aria-disabled="false" aria-pressed="true"><!--css-build:shady--><iron-icon id="icon" class="style-scope paper-icon-button"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope iron-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope iron-icon">
            <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-1.91l-.01-.01L23 10z" class="style-scope iron-icon"></path>
          </g></svg><!--css-build:shady-->
    </iron-icon></paper-icon-button>
      </ytmusic-like-button-renderer></div>
          <paper-icon-button id="button" class="dropdown-trigger style-scope ytmusic-menu-renderer" icon="yt-icons:more_vert" title="More actions" aria-label="More actions" role="button" tabindex="0" aria-disabled="false"><!--css-build:shady--><iron-icon id="icon" class="style-scope paper-icon-button"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope iron-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope iron-icon">
            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" class="style-scope iron-icon"></path>
          </g></svg><!--css-build:shady-->
    </iron-icon></paper-icon-button>
        <dom-if class="style-scope ytmusic-menu-renderer"><template is="dom-if"></template></dom-if>
      </ytmusic-menu-renderer>
        <div class="fixed-columns style-scope ytmusic-responsive-list-item-renderer">
            <yt-formatted-string class="fixed-column style-scope ytmusic-responsive-list-item-renderer complex-string" ellipsis-truncate="" size="MUSIC_RESPONSIVE_LIST_ITEM_FIXED_COLUMN_SIZE_SMALL" title="4:02"><span dir="auto" class="style-scope yt-formatted-string">4:02</span></yt-formatted-string>
          <dom-repeat as="column" class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-repeat"></template></dom-repeat>
        </div>
      </ytmusic-responsive-list-item-renderer><ytmusic-responsive-list-item-renderer class="style-scope ytmusic-shelf-renderer" has-badges="" should-render-subtitle-separators_="" num-flex-columns="3" is-interactive="" has-thumbnail-overlay_="" play-button-state="default">
        <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>
        <div class="left-items style-scope ytmusic-responsive-list-item-renderer">
            <ytmusic-thumbnail-renderer class="thumbnail style-scope ytmusic-responsive-list-item-renderer" image-width="56" thumbnail-crop_="MUSIC_THUMBNAIL_CROP_UNSPECIFIED">
        <yt-img-shadow id="image" class="image style-scope ytmusic-thumbnail-renderer no-transition" object-fit="CONTAIN" style="background-color: transparent;" loaded=""><img id="img" class="style-scope yt-img-shadow" alt="" width="56" src="https://lh3.googleusercontent.com/4Xrzzo3x4FvDrXbdwuDAW2xFOUz8zRPWuds-6DbyZx9cijkJOD5-vtjR266gXyuUsYloJkXDuBYkD6z1vQ=w60-h60-l90-rj"></yt-img-shadow>
      </ytmusic-thumbnail-renderer>
          <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>
          <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>
          <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>
            <ytmusic-item-thumbnail-overlay-renderer class="thumbnail-overlay style-scope ytmusic-responsive-list-item-renderer" indexed="" content-position="MUSIC_ITEM_THUMBNAIL_OVERLAY_CONTENT_POSITION_CENTERED" display-style="MUSIC_ITEM_THUMBNAIL_OVERLAY_DISPLAY_STYLE_PERSISTENT" play-button-state="default" animate-transitions_="">
        <ytmusic-background-overlay-renderer id="background" class="style-scope ytmusic-item-thumbnail-overlay-renderer" style="--ytmusic-background-overlay-background:linear-gradient(rgba(0,0,0,0.8),rgba(0,0,0,0.8));">
      </ytmusic-background-overlay-renderer>
        <div id="content" class="style-scope ytmusic-item-thumbnail-overlay-renderer">
            <ytmusic-play-button-renderer id="play-button" class="style-scope ytmusic-item-thumbnail-overlay-renderer" role="button" tabindex="0" animated="" state="default" aria-label="Play Zebani" size="MUSIC_PLAY_BUTTON_SIZE_SMALL" elevation="1" aria-disabled="false" style="--ytmusic-play-button-icon-color:rgba(255,255,255,1); --ytmusic-play-button-icon-loading-color:rgba(0,0,0,0); --ytmusic-play-button-background-color:rgba(0,0,0,0); --ytmusic-play-button-active-background-color:rgba(0,0,0,0); --ytmusic-play-button-loading-indicator-color:rgba(255,0,0,1); --ytmusic-play-button-active-scale-factor:1;">
        <div class="content-wrapper style-scope ytmusic-play-button-renderer">
          <yt-icon class="icon style-scope ytmusic-play-button-renderer"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope yt-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope yt-icon">
            <path d="M8 5v14l11-7z" class="style-scope yt-icon"></path>
          </g></svg>
      </yt-icon>
          <paper-spinner-lite class="loading-indicator style-scope ytmusic-play-button-renderer" hidden="" aria-hidden="true"><!--css-build:shady--><div id="spinnerContainer" class="  style-scope paper-spinner-lite"><div class="spinner-layer style-scope paper-spinner-lite"><div class="circle-clipper left style-scope paper-spinner-lite"><div class="circle style-scope paper-spinner-lite"></div></div><div class="circle-clipper right style-scope paper-spinner-lite"><div class="circle style-scope paper-spinner-lite"></div></div></div></div></paper-spinner-lite>
        </div>
      </ytmusic-play-button-renderer>
          <dom-if class="style-scope ytmusic-item-thumbnail-overlay-renderer"><template is="dom-if"></template></dom-if>
        </div>
      </ytmusic-item-thumbnail-overlay-renderer>
          <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>
          <yt-icon class="error style-scope ytmusic-responsive-list-item-renderer" icon="error"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope yt-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope yt-icon">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" class="style-scope yt-icon"></path>
          </g></svg>
      </yt-icon>
        </div>
        <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>
        <div class="flex-columns style-scope ytmusic-responsive-list-item-renderer">
          <div class="title-column style-scope ytmusic-responsive-list-item-renderer">
            <yt-formatted-string class="title style-scope ytmusic-responsive-list-item-renderer complex-string" ellipsis-truncate="" respect-html-dir="" title="Zebani"><span dir="auto" class="style-scope yt-formatted-string">Zebani</span></yt-formatted-string>
            <div id="columnar-layout-badges" class="badges style-scope ytmusic-responsive-list-item-renderer"><ytmusic-inline-badge-renderer class="style-scope ytmusic-responsive-list-item-renderer">
        <yt-icon class="icon style-scope ytmusic-inline-badge-renderer" title="Explicit" aria-label="Explicit"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope yt-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope yt-icon">
            <path d="M0 0h24v24H0z" fill="none" class="style-scope yt-icon"></path><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4 6h-4v2h4v2h-4v2h4v2H9V7h6v2z" class="style-scope yt-icon"></path>
          </g></svg>
      </yt-icon>
      </ytmusic-inline-badge-renderer></div>
          </div>
          <div id="stacked-layout-badges" class="badges style-scope ytmusic-responsive-list-item-renderer"><ytmusic-inline-badge-renderer class="style-scope ytmusic-responsive-list-item-renderer">
        <yt-icon class="icon style-scope ytmusic-inline-badge-renderer" title="Explicit" aria-label="Explicit"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope yt-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope yt-icon">
            <path d="M0 0h24v24H0z" fill="none" class="style-scope yt-icon"></path><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4 6h-4v2h4v2h-4v2h4v2H9V7h6v2z" class="style-scope yt-icon"></path>
          </g></svg>
        
        
      </yt-icon>
      </ytmusic-inline-badge-renderer></div>
          <div class="secondary-flex-columns style-scope ytmusic-responsive-list-item-renderer">
            
              <yt-formatted-string class="flex-column style-scope ytmusic-responsive-list-item-renderer complex-string" ellipsis-truncate="" respect-html-dir="" has-link-only_="" title="Contra"><a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="channel/UCE-ESXaARoPfTqPNMgtwyuQ" dir="auto">Contra</a></yt-formatted-string>
            
              <yt-formatted-string class="flex-column style-scope ytmusic-responsive-list-item-renderer complex-string" ellipsis-truncate="" respect-html-dir="" has-link-only_="" title="Zebani"><a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="browse/MPREb_k127r7tCDoZ" dir="auto">Zebani</a></yt-formatted-string>
            <dom-repeat as="column" class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-repeat"></template></dom-repeat>
          </div>
        </div>
        <ytmusic-menu-renderer class="menu style-scope ytmusic-responsive-list-item-renderer">
        
        
        <div id="top-level-buttons" class="style-scope ytmusic-menu-renderer"><ytmusic-like-button-renderer class="style-scope ytmusic-menu-renderer" like-status="LIKE">
        
        
        <paper-icon-button class="dislike style-scope ytmusic-like-button-renderer" title="Dislike" aria-label="Dislike" role="button" tabindex="0" aria-disabled="false" aria-pressed="false"><!--css-build:shady--><iron-icon id="icon" class="style-scope paper-icon-button"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope iron-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope iron-icon">
            <path d="M14.9 3H6c-.8 0-1.5.5-1.8 1.2l-3 7.3c-.1.2-.2.4-.2.7v2c0 1.1.9 2 2 2h6.3l-1 4.7v.3c0 .4.2.8.4 1.1.6.7 1.5.7 2.1.1l5.5-5.7c.4-.4.6-.9.6-1.4V5c0-1.1-.9-2-2-2zm-.2 12.6l-3.5 3.6c-.2.2-.5 0-.4-.2l1-4.6H4c-.6 0-1-.5-1-1v-1.1l2.7-6.6c.2-.5.6-.7 1-.7H14c.5 0 1 .5 1 1v8.8c-.1.3-.2.6-.3.8zM19 3h4v12h-4V3z" class="style-scope iron-icon"></path>
          </g></svg><!--css-build:shady-->
    </iron-icon></paper-icon-button>
        <paper-icon-button class="like style-scope ytmusic-like-button-renderer" title="Like" aria-label="Like" role="button" tabindex="0" aria-disabled="false" aria-pressed="true"><!--css-build:shady--><iron-icon id="icon" class="style-scope paper-icon-button"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope iron-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope iron-icon">
            <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-1.91l-.01-.01L23 10z" class="style-scope iron-icon"></path>
          </g></svg><!--css-build:shady-->
    </iron-icon></paper-icon-button>
      </ytmusic-like-button-renderer></div>
        
          <paper-icon-button id="button" class="dropdown-trigger style-scope ytmusic-menu-renderer" icon="yt-icons:more_vert" title="More actions" aria-label="More actions" role="button" tabindex="0" aria-disabled="false"><!--css-build:shady--><iron-icon id="icon" class="style-scope paper-icon-button"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope iron-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope iron-icon">
            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" class="style-scope iron-icon"></path>
          </g></svg><!--css-build:shady-->
    </iron-icon></paper-icon-button>
        <dom-if class="style-scope ytmusic-menu-renderer"><template is="dom-if"></template></dom-if>
      </ytmusic-menu-renderer>
        <div class="fixed-columns style-scope ytmusic-responsive-list-item-renderer">
          
            <yt-formatted-string class="fixed-column style-scope ytmusic-responsive-list-item-renderer complex-string" ellipsis-truncate="" size="MUSIC_RESPONSIVE_LIST_ITEM_FIXED_COLUMN_SIZE_SMALL" title="2:58"><span dir="auto" class="style-scope yt-formatted-string">2:58</span></yt-formatted-string>
          <dom-repeat as="column" class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-repeat"></template></dom-repeat>
        </div>
      </ytmusic-responsive-list-item-renderer></div>
        <div id="continuations" class="style-scope ytmusic-shelf-renderer"></div>
        <div class="more-button style-scope ytmusic-shelf-renderer">
          <dom-if class="style-scope ytmusic-shelf-renderer"><template is="dom-if"></template></dom-if>
        </div>
      </ytmusic-shelf-renderer></div>
      </ytmusic-item-section-renderer>
    \`
    
    document.querySelector("ytmusic-item-section-tab-renderer.iron-selected>.tab").innerText = "Downloaded Songs"
    
    document.querySelectorAll("ytmusic-responsive-list-item-renderer").forEach(element => {element.parentNode.removeChild(element)})
    
    function addColumn() {
        document.querySelector("#contents.ytmusic-shelf-renderer").innerHTML += \`<ytmusic-responsive-list-item-renderer class="style-scope ytmusic-shelf-renderer" should-render-subtitle-separators_="" num-flex-columns="3" is-interactive="" has-thumbnail-overlay_="" play-button-state="default">                <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>    <div class="left-items style-scope ytmusic-responsive-list-item-renderer">              <ytmusic-thumbnail-renderer class="thumbnail style-scope ytmusic-responsive-list-item-renderer" image-width="56" thumbnail-crop_="MUSIC_THUMBNAIL_CROP_UNSPECIFIED">            <yt-img-shadow id="image" class="image style-scope ytmusic-thumbnail-renderer no-transition" object-fit="CONTAIN" style="background-color: transparent;" loaded=""><img id="img" class="style-scope yt-img-shadow" alt="" width="56" src="https://lh3.googleusercontent.com/Oixp99ZJNogdwxw8N4hup_1GYgl7hKRxtA4uwHNS5tfvYd674AlDSHc5EF3wpmbkIlOrj7c1o3SYp9o=w60-h60-l90-rj"></yt-img-shadow>  </ytmusic-thumbnail-renderer>      <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>      <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>      <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>              <ytmusic-item-thumbnail-overlay-renderer class="thumbnail-overlay style-scope ytmusic-responsive-list-item-renderer" indexed="" content-position="MUSIC_ITEM_THUMBNAIL_OVERLAY_CONTENT_POSITION_CENTERED" display-style="MUSIC_ITEM_THUMBNAIL_OVERLAY_DISPLAY_STYLE_PERSISTENT" play-button-state="default" animate-transitions_="">            <ytmusic-background-overlay-renderer id="background" class="style-scope ytmusic-item-thumbnail-overlay-renderer" style="--ytmusic-background-overlay-background:linear-gradient(rgba(0,0,0,0.8),rgba(0,0,0,0.8));">          </ytmusic-background-overlay-renderer>    <div id="content" class="style-scope ytmusic-item-thumbnail-overlay-renderer">              <ytmusic-play-button-renderer id="play-button" class="style-scope ytmusic-item-thumbnail-overlay-renderer" role="button" tabindex="0" animated="" state="default" aria-label="Play Yine Olmad�" size="MUSIC_PLAY_BUTTON_SIZE_SMALL" elevation="1" aria-disabled="false" style="--ytmusic-play-button-icon-color:rgba(255,255,255,1); --ytmusic-play-button-icon-loading-color:rgba(0,0,0,0); --ytmusic-play-button-background-color:rgba(0,0,0,0); --ytmusic-play-button-active-background-color:rgba(0,0,0,0); --ytmusic-play-button-loading-indicator-color:rgba(255,0,0,1); --ytmusic-play-button-active-scale-factor:1;">            <div class="content-wrapper style-scope ytmusic-play-button-renderer">      <yt-icon class="icon style-scope ytmusic-play-button-renderer"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope yt-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope yt-icon">        <path d="M8 5v14l11-7z" class="style-scope yt-icon"></path>      </g></svg>          </yt-icon>      <paper-spinner-lite class="loading-indicator style-scope ytmusic-play-button-renderer" hidden="" aria-hidden="true"><!--css-build:shady--><div id="spinnerContainer" class="  style-scope paper-spinner-lite"><div class="spinner-layer style-scope paper-spinner-lite"><div class="circle-clipper left style-scope paper-spinner-lite"><div class="circle style-scope paper-spinner-lite"></div></div><div class="circle-clipper right style-scope paper-spinner-lite"><div class="circle style-scope paper-spinner-lite"></div></div></div></div></paper-spinner-lite>    </div>  </ytmusic-play-button-renderer>      <dom-if class="style-scope ytmusic-item-thumbnail-overlay-renderer"><template is="dom-if"></template></dom-if>    </div>      </ytmusic-item-thumbnail-overlay-renderer>      <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>      <yt-icon class="error style-scope ytmusic-responsive-list-item-renderer" icon="error"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope yt-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope yt-icon">        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" class="style-scope yt-icon"></path>      </g></svg>          </yt-icon>    </div>    <dom-if class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-if"></template></dom-if>    <div class="flex-columns style-scope ytmusic-responsive-list-item-renderer">      <div class="title-column style-scope ytmusic-responsive-list-item-renderer">                <yt-formatted-string class="title style-scope ytmusic-responsive-list-item-renderer complex-string" ellipsis-truncate="" respect-html-dir="" title="Yine Olmad�"><span dir="auto" class="style-scope yt-formatted-string">Yine Olmad�</span></yt-formatted-string>        <div id="columnar-layout-badges" class="badges style-scope ytmusic-responsive-list-item-renderer"></div>      </div>      <div id="stacked-layout-badges" class="badges style-scope ytmusic-responsive-list-item-renderer"></div>      <div class="secondary-flex-columns style-scope ytmusic-responsive-list-item-renderer">                  <yt-formatted-string class="flex-column style-scope ytmusic-responsive-list-item-renderer complex-string" ellipsis-truncate="" respect-html-dir="" has-link-only_="" title="Patron"><a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="channel/UCEt0wC5cVBZvQAjFq88H4kA" dir="auto">Patron</a></yt-formatted-string>                  <yt-formatted-string class="flex-column style-scope ytmusic-responsive-list-item-renderer complex-string" ellipsis-truncate="" respect-html-dir="" has-link-only_="" title="Totem"><a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="browse/MPREb_gcFpHO3eaCg" dir="auto">Totem</a></yt-formatted-string>        <dom-repeat as="column" class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-repeat"></template></dom-repeat>      </div>    </div>    <ytmusic-menu-renderer class="menu style-scope ytmusic-responsive-list-item-renderer">            <div id="top-level-buttons" class="style-scope ytmusic-menu-renderer"><ytmusic-like-button-renderer class="style-scope ytmusic-menu-renderer" like-status="LIKE">            <paper-icon-button class="dislike style-scope ytmusic-like-button-renderer" title="Dislike" aria-label="Dislike" role="button" tabindex="0" aria-disabled="false" aria-pressed="false"><!--css-build:shady--><iron-icon id="icon" class="style-scope paper-icon-button"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope iron-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope iron-icon">        <path d="M14.9 3H6c-.8 0-1.5.5-1.8 1.2l-3 7.3c-.1.2-.2.4-.2.7v2c0 1.1.9 2 2 2h6.3l-1 4.7v.3c0 .4.2.8.4 1.1.6.7 1.5.7 2.1.1l5.5-5.7c.4-.4.6-.9.6-1.4V5c0-1.1-.9-2-2-2zm-.2 12.6l-3.5 3.6c-.2.2-.5 0-.4-.2l1-4.6H4c-.6 0-1-.5-1-1v-1.1l2.7-6.6c.2-.5.6-.7 1-.7H14c.5 0 1 .5 1 1v8.8c-.1.3-.2.6-.3.8zM19 3h4v12h-4V3z" class="style-scope iron-icon"></path>      </g></svg><!--css-build:shady--></iron-icon></paper-icon-button>    <paper-icon-button class="like style-scope ytmusic-like-button-renderer" title="Like" aria-label="Like" role="button" tabindex="0" aria-disabled="false" aria-pressed="true"><!--css-build:shady--><iron-icon id="icon" class="style-scope paper-icon-button"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope iron-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope iron-icon">        <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-1.91l-.01-.01L23 10z" class="style-scope iron-icon"></path>      </g></svg><!--css-build:shady--></iron-icon></paper-icon-button>  </ytmusic-like-button-renderer></div>          <paper-icon-button id="button" class="dropdown-trigger style-scope ytmusic-menu-renderer" icon="yt-icons:more_vert" title="More actions" aria-label="More actions" role="button" tabindex="0" aria-disabled="false"><!--css-build:shady--><iron-icon id="icon" class="style-scope paper-icon-button"><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope iron-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope iron-icon">        <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" class="style-scope iron-icon"></path>      </g></svg><!--css-build:shady--></iron-icon></paper-icon-button>    <dom-if class="style-scope ytmusic-menu-renderer"><template is="dom-if"></template></dom-if>  </ytmusic-menu-renderer>    <div class="fixed-columns style-scope ytmusic-responsive-list-item-renderer">              <yt-formatted-string class="fixed-column style-scope ytmusic-responsive-list-item-renderer complex-string" ellipsis-truncate="" size="MUSIC_RESPONSIVE_LIST_ITEM_FIXED_COLUMN_SIZE_SMALL" title="4:41"><span dir="auto" class="style-scope yt-formatted-string">4:41</span></yt-formatted-string>      <dom-repeat as="column" class="style-scope ytmusic-responsive-list-item-renderer"><template is="dom-repeat"></template></dom-repeat>    </div>  </ytmusic-responsive-list-item-renderer>\`
    }
    
    
    for (song in downloadedSongs)
        addColumn();
    
    for (let i = 0; i < downloadedSongs.length; i++) {
        const song = downloadedSongs[i];
        // TITLE
        document.querySelectorAll(".title-column>yt-formatted-string")[i].setAttribute("title",song.title);
        document.querySelectorAll(".title-column>yt-formatted-string")[i].innerText = song.title;
        // ARTIST
        document.querySelectorAll(".secondary-flex-columns.style-scope.ytmusic-responsive-list-item-renderer")[i].querySelectorAll("yt-formatted-string")[0].setAttribute("title",song.artist);
        document.querySelectorAll(".secondary-flex-columns.style-scope.ytmusic-responsive-list-item-renderer")[i].querySelectorAll("yt-formatted-string")[0].innerText = song.artist;
        // ALBUM
        document.querySelectorAll(".secondary-flex-columns.style-scope.ytmusic-responsive-list-item-renderer")[i].querySelectorAll("yt-formatted-string")[1].setAttribute("title",song.album);
        document.querySelectorAll(".secondary-flex-columns.style-scope.ytmusic-responsive-list-item-renderer")[i].querySelectorAll("yt-formatted-string")[1].innerText = song.album;
        // TIME
        let timeText = \`\${parseInt(song.time/60)}:\${((parseInt(song.time % 60)).toString().length == 1 ? "0" : "") + parseInt(song.time % 60)}\`;
        document.querySelectorAll(".fixed-columns.style-scope.ytmusic-responsive-list-item-renderer>yt-formatted-string")[i].setAttribute("title",timeText)
        document.querySelectorAll(".fixed-columns.style-scope.ytmusic-responsive-list-item-renderer>yt-formatted-string")[i].innerText = timeText;
        // EXPLICIT
        document.querySelectorAll("#columnar-layout-badges")[i].innerHTML = \`<ytmusic-inline-badge-renderer class="style-scope ytmusic-responsive-list-item-renderer"><yt-icon class="icon style-scope ytmusic-inline-badge-renderer"></yt-icon></ytmusic-inline-badge-renderer>\`;
        document.querySelectorAll(".icon.style-scope.ytmusic-inline-badge-renderer")[i].innerHTML = song.explicit ? \`<svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope yt-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope yt-icon"><path d="M0 0h24v24H0z" fill="none" class="style-scope yt-icon"></path><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4 6h-4v2h4v2h-4v2h4v2H9V7h6v2z" class="style-scope yt-icon"></path></g></svg>\` : \`\`;
        // COVER PHOTO
        document.querySelectorAll(".content-wrapper.style-scope.ytmusic-play-button-renderer>yt-icon")[i].innerHTML = \`<svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" class="style-scope yt-icon" style="pointer-events: none; display: block; width: 100%; height: 100%;"><g class="style-scope yt-icon">        <path d="M8 5v14l11-7z" class="style-scope yt-icon"></path>      </g></svg>\`;
        document.querySelectorAll("ytmusic-thumbnail-renderer>yt-img-shadow>img")[i].outerHTML = \`<img id="img" class="style-scope yt-img-shadow" alt="" width="56" src="\${song.imgURL}">\`;
    }
    `
}