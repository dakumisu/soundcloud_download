// downloader.js
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
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
	.help()
	.argv;

const playlistUrl = argv.url;
const urlParts = playlistUrl.split('/').filter(Boolean);
const defaultFolderName = "Soundcloud_Playlist_Download";
const folder = 'download/' + (argv.folder || urlParts[urlParts.length - 1] || defaultFolderName);
const maxDuration = argv.maxDuration * 60;

const fullPath = join(__dirname, folder);
const cachePath = join(__dirname, '.cache');
const cacheFile = join(cachePath, 'downloaded.json');

if (!existsSync(fullPath)) mkdirSync(fullPath);
if (!existsSync(cachePath)) mkdirSync(cachePath);

let downloadedIds = [];
if (existsSync(cacheFile)) {
	downloadedIds = JSON.parse(readFileSync(cacheFile));
}

console.log('\n📡 Fetching playlist metadata...');
const metadataCmd = [
	playlistUrl,
	'--flat-playlist',
	'--dump-json',
	'--no-warnings'
];

let rawOutput = '';
const meta = pty.spawn('yt-dlp', metadataCmd, { cwd: process.cwd(), env: process.env });
meta.on('data', (data) => { rawOutput += data; });

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
		const already = downloadedIds.includes(track.id);
		const tooLong = track.duration && track.duration > maxDuration;

		if (already) {
			console.log(`⏩ Already downloaded: ${track.webpage_url_basename}`);
		}
		if (tooLong) {
			console.log(`⏩ Skipping long track (${Math.round(track.duration / 60)} min): ${track.webpage_url_basename}`);
		}

		return !already && !tooLong;
	});

	if (tracksToDownload.length === 0) {
		console.log('\n✅ Nothing to download.');
		return;
	}

	const bar = new cliProgress.SingleBar({
		format: (options, params, payload) => {
			const percentage = (params.percentage ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
			return `📦 ${params.bar} | ${percentage}% | ${params.value}/${params.total} | ${payload.filename}`;
		},
		barCompleteChar: '█',
		barIncompleteChar: '░',
		hideCursor: true,
	}, cliProgress.Presets.shades_classic);

	let downloaded = 0;
	bar.start(tracksToDownload.length, 0, { filename: '' });

	const downloadNext = (index) => {
		if (index >= tracksToDownload.length) {
			bar.stop();
			writeFileSync(cacheFile, JSON.stringify(downloadedIds, null, 2));
			console.log('\n🎉 Done! All new tracks downloaded.');
			return;
		}

		const track = tracksToDownload[index];
		bar.update(index, { filename: track.webpage_url_basename });

		const args = [
			track.url,
			'--output', `${folder}/%(uploader)s - %(title)s.%(ext)s`,
			'--extract-audio',
			'--audio-format', 'mp3',
			'--audio-quality', '0',
			'--add-metadata',
			'--embed-thumbnail',
			'--no-warnings',
			'--newline',
			'--flat-playlist'
		];

		const dl = pty.spawn('yt-dlp', args, { cwd: process.cwd(), env: process.env });

		let trackBar = new cliProgress.SingleBar({
			format: '🎵 {trackId} | {bar} | {percentage}% | {trackProgress}',
			barCompleteChar: '█',
			barIncompleteChar: '░',
			hideCursor: true,
		}, cliProgress.Presets.shades_classic);

		let trackBarInstance = null;

		// Track download progress
		let lastTrackProgress = '';

		// Set up the progress bar for the whole playlist
		bar.start(tracksToDownload.length, 0, { filename: '' });

		// Track download progress
		dl.on('data', (chunk) => {
			const output = chunk.toString();

			// Look for the download percentage in the output
			const match = output.match(/\[download\]\s+(\d{1,3}\.\d)%/);

			// Ensure match is not null before accessing match[1]
			if (match && match[1]) {
				lastTrackProgress = `${parseFloat(match[1]).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;

				// Update track progress line (first line: track name and progress)
				process.stdout.clearLine(0);
				process.stdout.cursorTo(0);
				process.stdout.write(`🎵 Downloading: ${track.webpage_url_basename} | 📈 Track Progress: ${lastTrackProgress}`);

				// If no track progress bar exists, create one for the first track
				if (!trackBarInstance) {
					trackBarInstance = new cliProgress.SingleBar({
						format: '📦 ' + '{bar} | {percentage}% | {value}/{total} | ' + '{trackName} - {trackProgress}',
						barCompleteChar: '█',
						barIncompleteChar: '░',
						hideCursor: true,
					}, cliProgress.Presets.shades_classic);

					trackBarInstance.start(100, 0, {
						trackName: track.webpage_url_basename,
						trackProgress: lastTrackProgress
					});
				} else {
					// Update track progress bar for the current track
					trackBarInstance.update(parseFloat(match[1]), {
						trackName: track.webpage_url_basename,
						trackProgress: lastTrackProgress
					});
				}
			}
		});

		// When track download finishes
		dl.on('exit', () => {
			// Stop the track progress bar if it exists
			if (trackBarInstance) {
				trackBarInstance.stop();
			}

			// Update the global playlist progress
			downloadedIds.push(track.webpage_url_basename); // Use track.webpage_url_basename here
			downloaded++;
			bar.update(downloaded);

			// Start the next download
			downloadNext(index + 1);
		});


	};

	downloadNext(0);
});
