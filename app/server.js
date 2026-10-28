const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { execFile } = require('child_process');

const { runStationUploads } = require('./automation/stationupload');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
    dest: path.join(__dirname, 'uploads'),
    limits: {
        fileSize: 500 * 1024 * 1024
    }
});

const uploadFields = upload.fields([
    { name: 'stationZip', maxCount: 1 },
    { name: 'userConfig', maxCount: 1 }
]);

let isRunning = false;

app.post('/start-upload', uploadFields, async (req, res) => {
    if (isRunning) {
        return res.status(409).json({
            error: 'An upload job is already running. Please wait.'
        });
    }

    const stationZipFile = req.files?.stationZip?.[0];
    const userConfigFile = req.files?.userConfig?.[0];

    if (!stationZipFile) {
        return res.status(400).json({
            error: 'Station input ZIP file is missing.'
        });
    }

    if (!userConfigFile) {
        return res.status(400).json({
            error: 'station_user.json file is missing.'
        });
    }

    if (path.extname(stationZipFile.originalname).toLowerCase() !== '.zip') {
        return res.status(400).json({
            error: 'First file must be a .zip file.'
        });
    }

    if (path.extname(userConfigFile.originalname).toLowerCase() !== '.json') {
        return res.status(400).json({
            error: 'Second file must be a .json file.'
        });
    }

    isRunning = true;

    const extractedPath = path.join(
        __dirname,
        'uploads',
        `extracted-${Date.now()}`
    );

    try {
        const zip = new AdmZip(stationZipFile.path);
        zip.extractAllTo(extractedPath, true);

        // Support both archive structures:
        // 1. CCDx_TESTING/station/files
        // 2. station/files
        const wrappedFolder = path.join(extractedPath, 'CCDx_TESTING');

        const stationRootPath =
            fs.existsSync(wrappedFolder) &&
                fs.statSync(wrappedFolder).isDirectory()
                ? wrappedFolder
                : extractedPath;

        console.log('Extraction folder:', extractedPath);
        console.log('Station root folder:', stationRootPath);

        const userData = JSON.parse(
            fs.readFileSync(userConfigFile.path, 'utf-8')
        );

        if (!Array.isArray(userData.user_credentials)) {
            throw new Error('station_user.json must contain user_credentials array.');
        }

        if (!Array.isArray(userData.station_name)) {
            throw new Error('station_user.json must contain station_name array.');
        }

        const availableStations = fs.readdirSync(stationRootPath)
            .filter(name =>
                fs.statSync(path.join(stationRootPath, name)).isDirectory()
            );

        const missingStations = userData.station_name.filter(
            station => !availableStations.includes(station)
        );

        if (missingStations.length) {
            throw new Error(
                `Stations not found in ZIP: ${missingStations.join(', ')}`
            );
        }

        const results = await runStationUploads(
            userData.station_name,
            userData.user_credentials,
            stationRootPath
        );
        const reportFolder = path.join(__dirname, 'results');
        fs.mkdirSync(reportFolder, { recursive: true });

        const reportPath = path.join(
            reportFolder,
            `station-upload-report-${Date.now()}.json`
        );

        fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

        res.json({
            message: 'Station upload completed.',
            results,
            reportPath
        });
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    } finally {
        isRunning = false;

        try {
            fs.rmSync(extractedPath, { recursive: true, force: true });
            fs.rmSync(stationZipFile.path, { force: true });
            fs.rmSync(userConfigFile.path, { force: true });
        } catch {
            // Ignore cleanup errors
        }
    }
});

function detectStationFolders(extractedPath) {
    const topLevelItems = fs.readdirSync(extractedPath);

    let stationFolders = topLevelItems.filter(name =>
        fs.statSync(path.join(extractedPath, name)).isDirectory()
    );

    if (
        stationFolders.length === 1 &&
        stationFolders[0] === 'CCDx_TESTING'
    ) {
        const ccdxPath = path.join(extractedPath, 'CCDx_TESTING');

        stationFolders = fs.readdirSync(ccdxPath).filter(name =>
            fs.statSync(path.join(ccdxPath, name)).isDirectory()
        );
    }

    return stationFolders;
}

// app.listen(3000, () => {
//     console.log('Station Upload Tool running at http://localhost:3000');
// });

const HOST = '127.0.0.1';
const PORT = 3000;
const URL = `http://${HOST}:${PORT}`;

const server = app.listen(PORT, HOST, () => {
    console.log(`Station Upload Tool running at ${URL}`);
    console.log('Keep this window open while using the tool.');

    execFile('explorer.exe', [URL], error => {
        if (error) {
            console.log(`Please open ${URL} manually.`);
        }
    });
});

server.on('error', error => {
    console.error('Unable to start the tool:', error.message);
    process.exitCode = 1;
});