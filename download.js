import cliProgress from 'cli-progress';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import pty from 'node-pty';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// ───── Helpers ─────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sanitize = (str) => str.replace(/[\/\\:*?"<>|]/g, '-').trim();
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ───── CLI Args ─────
const argv = yargs(hideBin(process.argv))
	.option('url', {
		alias: 'u',
		describe: 'SoundCloud playlist URL(s)',
		type: 'string',
		array: true,
		coerce: (val) => {
			// Flatten multiple comma-separated entries into one array
			return val.flatMap(entry => entry.split(',').map(s => s.trim()));
		}
	})
	.option('folder', {
		alias: 'f',
		describe: 'Base folder to save downloaded tracks',
		type: 'string'
	})
	.option('max-duration', {
		alias: 'd',
		describe: 'Maximum track duration in minutes',
		type: 'number',
		default: 20
	})
	.option('clear-cache', {
		describe: 'Clear the download cache for each playlist',
		type: 'boolean',
		default: false
	})
	.help()
	.argv;

const outputPath = join(__dirname, 'output');
const cachePath = join(__dirname, '.cache');
const maxDuration = argv['max-duration'] * 60;

if (!existsSync(outputPath)) mkdirSync(outputPath);
if (!existsSync(cachePath)) mkdirSync(cachePath);

// ───── Main ─────
const run = async () => {
	for (const url of argv.url) {
		await handlePlaylist(url);
		await wait(500); // slight delay between playlists
	}

	console.log('🎉 All playlists processed.');
};

// ───── Core Logic ─────
async function handlePlaylist(playlistUrl) {
	const albumData = {
		url: playlistUrl,
		artist: '',
		title: '',
		tracks: []
	};

	console.log('\n📡 Fetching metadata for:', playlistUrl);

	const metadataCmd = [
		playlistUrl,
		'--flat-playlist',
		'--dump-json',
		'--no-warnings'
	];

	let rawOutput = '';
	let hasBeenInitialized = false;

	const meta = pty.spawn('yt-dlp', metadataCmd, { cwd: process.cwd(), env: process.env });

	let folder = '';
	let fullPath = '';
	let cacheFile = '';
	let downloadedIds = [];
	let cacheData = { ...albumData };

	return new Promise((resolveMeta) => {
		meta.on('data', (data) => {
			rawOutput += data.toString();

			if (hasBeenInitialized) return;
			hasBeenInitialized = true;

			albumData.artist = rawOutput.match(/"album_artist": "(.*?)"/)?.[1]
			albumData.title = argv.folder || rawOutput.match(/"album": "(.*?)"/)?.[1] || 'Soundcloud_Playlist';

			folder = sanitize(albumData.title);
			fullPath = join(outputPath, folder);
			cacheFile = join(cachePath, `cache_${folder}.json`);

			if (!existsSync(fullPath)) mkdirSync(fullPath);

			// Remove non-MP3 files
			const existingFiles = readdirSync(fullPath);
			for (const file of existingFiles) {
				if (!file.endsWith('.mp3')) {
					try {
						unlinkSync(join(fullPath, file));
					} catch (err) {
						console.warn('⚠️ Failed to delete:', file);
					}
				}
			}

			if (argv.clearCache && existsSync(cacheFile)) {
				console.log('🧹 Clearing cache for:', folder);
				unlinkSync(cacheFile);
			}

			if (existsSync(cacheFile)) {
				try {
					cacheData = JSON.parse(readFileSync(cacheFile));
					downloadedIds = cacheData.tracks || [];
				} catch {
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

			Object.assign(cacheData, albumData);

			const tracksToDownload = tracks.filter(track => {
				const already = downloadedIds.some(d => d.id === track.id);
				const tooLong = track.duration && track.duration > maxDuration;
				if (already) console.log(`⏩ Already downloaded: ${track.webpage_url_basename}`);
				if (tooLong) console.log(`⏩ Skipping long track: ${track.webpage_url_basename}`);
				return !already && !tooLong;
			});

			if (tracksToDownload.length === 0) {
				console.log('\n✅ Nothing new to download.');
				return resolveMeta();
			}

			const playlistBar = new cliProgress.SingleBar({
				format: '📦 {bar} | {percentage}% | {value}/{total} | {filename}',
				barCompleteChar: '█',
				barIncompleteChar: '░',
				hideCursor: true,
				clearOnComplete: false
			}, cliProgress.Presets.shades_classic);

			playlistBar.start(tracksToDownload.length, 0, { filename: '' });

			let downloaded = 0;
			const spinnerFrames = ['⠋', '⠙', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
			let spinnerIndex = 0;

			const downloadNext = (index) => {
				if (index >= tracksToDownload.length) {
					playlistBar.stop();
					console.log(`✅ Playlist ${folder} downloaded.`);
					return resolveMeta();
				}

				const track = tracksToDownload[index];
				const filename = sanitize(track.webpage_url_basename);
				playlistBar.update(index, { filename });

				const args = [
					track.url,
					'--output', `${fullPath}/%(title)s.%(ext)s`,
					'--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0',
					'--add-metadata', '--embed-thumbnail', '--no-warnings', '--newline',
					'--restrict-filenames'
				];

				const dl = pty.spawn('yt-dlp', args, { cwd: process.cwd(), env: process.env });

				const spinner = setInterval(() => {
					spinnerIndex++;
					playlistBar.update(downloaded, {
						filename: `${filename} ${spinnerFrames[spinnerIndex % spinnerFrames.length]}`
					});
				}, 100);

				dl.on('exit', () => {
					clearInterval(spinner);

					cacheData.tracks.push({
						id: track.id,
						filename,
						url: track.url
					});

					writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
					downloaded++;
					playlistBar.update(downloaded);
					downloadNext(index + 1);
				});
			};

			downloadNext(0);
		});
	});
}

run();
