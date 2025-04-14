// downloader.js
import { join, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import pty from 'node-pty';
import cliProgress from 'cli-progress';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const argv = yargs(hideBin(process.argv))
	.option('url', {
		alias: 'u',
		describe: 'SoundCloud playlist URL',
		type: 'string',
		demandOption: true
	})
	.option('folder', {
		alias: 'f',
		describe: 'Folder to save downloaded tracks',
		type: 'string'
	})
	.option('max-duration', {
		alias: 'd',
		describe: 'Maximum track duration in minutes',
		type: 'number',
		default: 20
	})
	.option('clear-cache', {
		describe: 'Clear the download cache for the folder',
		type: 'boolean',
		default: false
	})
	.help()
	.argv;

const playlistUrl = argv.url;
const playlistName = playlistUrl.split('/').filter(Boolean).pop().split('?').filter(Boolean).shift()
const defaultFolderName = "Soundcloud_Playlist_Download";
// const folder = 'output/' + (argv.folder || playlistName || defaultFolderName);
const maxDuration = argv.maxDuration * 60;

const outputPath = join(__dirname, 'output');
// const fullPath = join(__dirname, folder);
const cachePath = join(__dirname, '.cache');
// const cacheFile = join(cachePath, `${folder.replace(/[\/]/g, '_')}.json`);

let hasBeenInitialized = false;

const ALBUM_DATA = {
	url: playlistUrl,
	artist: '',
	title: '',
	tracks: []
};


let folder = null
let fullPath = null
let cacheFile = null

if (!existsSync(outputPath)) mkdirSync(outputPath);
// if (!existsSync(fullPath)) mkdirSync(fullPath);
if (!existsSync(cachePath)) mkdirSync(cachePath);

// if (argv.clearCache && existsSync(cacheFile)) {
// 	console.log('🧹 Clearing cache file...');
// 	unlinkSync(cacheFile);
// }

let downloadedIds = [];
// if (existsSync(cacheFile)) {
// 	try {
// 		downloadedIds = JSON.parse(readFileSync(cacheFile));
// 	} catch (err) {
// 		downloadedIds = [];
// 	}
// }

console.log('\n📡 Fetching playlist metadata...');
const metadataCmd = [
	playlistUrl,
	'--flat-playlist',
	'--dump-json',
	'--no-warnings'
];

let rawOutput = '';
const meta = pty.spawn('yt-dlp', metadataCmd, { cwd: process.cwd(), env: process.env });

meta.on('data', (data) => {
	rawOutput += data;
	console.log(data.toString());

	if (hasBeenInitialized) return;

	ALBUM_DATA.title = rawOutput.match(/"album": "(.*?)"/)?.[1];
	ALBUM_DATA.artist = rawOutput.match(/"album_artist": "(.*?)"/)?.[1];

	const folderName = argv.folder || ALBUM_DATA.title || defaultFolderName;
	// sanitizing folder name
	folder = folderName.replace(/[\/\\:*?"<>|]/g, "-")
	folder = folderName;
	fullPath = join(outputPath, folder);
	cacheFile = join(cachePath, `cache_${folder.replace(/[\/]/g, '_')}.json`);

	if (!existsSync(fullPath)) mkdirSync(fullPath);
	if (argv.clearCache && existsSync(cacheFile)) {
		console.log('🧹 Clearing cache file...');
		unlinkSync(cacheFile);
	}
	if (existsSync(cacheFile)) {
		try {
			downloadedIds = JSON.parse(readFileSync(cacheFile));
		} catch (err) {
			downloadedIds = [];
		}
	}
});

meta.on('exit', () => {
	const lines = rawOutput.trim().split('\n');
	const tracks = lines.map(line => {
		try {
			return JSON.parse(line);
		} catch {
			return null;
		}
	}).filter(Boolean);

	const tracksToDownload = tracks.filter(track => {
		const already = downloadedIds.some(d => d.id === track.id);
		const tooLong = track.duration && track.duration > maxDuration;
		if (already) console.log(`⏩ Already downloaded: ${track.webpage_url_basename}`);
		if (tooLong) console.log(`⏩ Skipping long track: ${track.webpage_url_basename}`);
		return !already && !tooLong;
	});

	if (tracksToDownload.length === 0) {
		console.log('\n✅ Nothing to download.');
		return;
	}

	console.log();

	const playlistBar = new cliProgress.SingleBar({
		format: '📦 {bar} | {percentage}% | {value}/{total} | {filename}',
		barCompleteChar: '█',
		barIncompleteChar: '░',
		hideCursor: true,
		clearOnComplete: false
	}, cliProgress.Presets.shades_classic);

	let downloaded = 0;
	playlistBar.start(tracksToDownload.length, 0, { filename: '' });

	const spinnerFrames = ['⠋', '⠙', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
	let spinnerIndex = 0;

	const downloadNext = (index) => {
		if (index >= tracksToDownload.length) {
			playlistBar.stop();
			console.log('\n🎉 Done! All new tracks downloaded.');
			return;
		}

		const track = tracksToDownload[index];
		const filename = track.webpage_url_basename
		playlistBar.update(index, { filename });

		const args = [
			track.url,
			'--output', `${fullPath}/%(title)s.%(ext)s`,
			'--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0',
			'--add-metadata', '--embed-thumbnail', '--no-warnings', '--newline'
		];

		const dl = pty.spawn('yt-dlp', args, { cwd: process.cwd(), env: process.env });

		const spinner = setInterval(() => {
			spinnerIndex++;
			playlistBar.update(downloaded, { filename: `${filename} ${spinnerFrames[spinnerIndex % spinnerFrames.length]}` });
		}, 100);

		dl.on('exit', () => {
			clearInterval(spinner);

			const downloadedTrackPath = join(__dirname, folder, `${filename}.mp3`);
			downloadedIds.push({
				id: track.id,
				filename,
				url: downloadedTrackPath
			});
			writeFileSync(cacheFile, JSON.stringify(downloadedIds, null, 2));

			downloaded++;
			playlistBar.update(downloaded);
			downloadNext(index + 1);
		});
	};

	downloadNext(0);
});
