import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import promptSync from 'prompt-sync';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

dotenv.config();
const prompt = promptSync();

const CLIENT_ID = process.env.CLIENT_ID;
const OAUTH_TOKEN = process.env.OAUTH_TOKEN;

const api = axios.create({
	baseURL: 'https://api.soundcloud.com',
	headers: {
		Authorization: `OAuth ${OAUTH_TOKEN}`,
	},
});

console.log(api);


// Rate limiter with exponential backoff
const requestWithRetry = async (fn, retries = 5, delay = 1000) => {
	for (let i = 0; i < retries; i++) {
		try {
			return await fn();
		} catch (err) {
			if (err.response?.status === 429) {
				const waitTime = delay * Math.pow(2, i);
				console.warn(`⚠️ Rate limit hit. Retrying in ${waitTime / 1000}s...`);
				await new Promise((res) => setTimeout(res, waitTime));
			} else {
				throw err;
			}
		}
	}
	throw new Error('Max retries exceeded');
};

// Simple file-based cache
const cacheDir = path.resolve('.cache');
fs.ensureDirSync(cacheDir);

const cachePath = (id) => path.join(cacheDir, `${id}.json`);

const getCached = (id) => {
	const p = cachePath(id);
	return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p)) : null;
};

const setCached = (id, data) => {
	fs.writeFileSync(cachePath(id), JSON.stringify(data, null, 2));
};

// Resolve a SoundCloud playlist
const resolvePlaylist = async (url) => {
	const resolveUrl = `https://api.soundcloud.com/resolve?url=${url}&client_id=${CLIENT_ID}`;
	const response = await requestWithRetry(() => axios.get(resolveUrl));
	return response.data;
};

// Get or cache tracks
const getPlaylistTracks = async (playlistId) => {
	const cached = getCached(playlistId);
	if (cached) {
		console.log(`📦 Loaded ${cached.length} track(s) from cache for playlist ${playlistId}`);
		return cached;
	}

	const response = await requestWithRetry(() => api.get(`/playlists/${playlistId}`));
	const tracks = response.data.tracks;
	setCached(playlistId, tracks);
	return tracks;
};

const createPlaylist = async (title, tracks, sharing = 'public') => {
	const trackIds = tracks.map((t) => ({ id: t.id }));
	const response = await requestWithRetry(() =>
		api.post(`/playlists`, {
			playlist: {
				title,
				sharing,
				tracks: trackIds,
			},
		})
	);
	return response.data;
};

const updatePlaylist = async (playlistId, newTracks, mode, verbose = false) => {
	const existing = await getPlaylistTracks(playlistId);
	const existingIds = new Set(existing.map((t) => t.id));
	let updatedTracks;

	if (mode === 'append') {
		const newUniqueTracks = newTracks.filter((t) => !existingIds.has(t.id));
		updatedTracks = [...existing, ...newUniqueTracks];
		console.log(`Appending ${newUniqueTracks.length} new track(s)...`);
		if (verbose) {
			newUniqueTracks.forEach((t) => console.log(`+ ${t.title} by ${t.user.username}`));
		}
	} else {
		updatedTracks = newTracks;
		console.log(`Overwriting with ${newTracks.length} track(s)...`);
		if (verbose) {
			newTracks.forEach((t) => console.log(`> ${t.title} by ${t.user.username}`));
		}
	}

	const trackIds = updatedTracks.map((t) => ({ id: t.id }));
	const response = await requestWithRetry(() =>
		api.put(`/playlists/${playlistId}`, {
			playlist: {
				tracks: trackIds,
			},
		})
	);

	return response.data;
};

// CLI parsing
const argv = yargs(hideBin(process.argv))
	.option('source', { alias: 's', type: 'string', description: 'Source playlist URL' })
	.option('destination', { alias: 'd', type: 'string', description: 'Destination playlist URL' })
	.option('mode', { alias: 'm', choices: ['append', 'overwrite'], default: 'append' })
	.option('private', { alias: 'p', type: 'boolean', default: false })
	.option('verbose', { alias: 'v', type: 'boolean', default: true })
	.help().argv;

const main = async () => {
	const sourceUrl = argv.source || prompt('Enter source playlist URL: ');
	const destUrl = argv.destination ?? prompt('Enter destination playlist URL (leave empty to create new): ');
	const mode = argv.mode || prompt('Append or Overwrite? (append/overwrite): ') || 'append';
	const sharing = argv.private ? 'private' : 'public';
	const verbose = argv.verbose;

	try {
		console.log('🔍 Resolving source playlist...');
		const source = await resolvePlaylist(sourceUrl);
		console.log(source);

		const sourceTracks = await getPlaylistTracks(source.id);

		let destination;

		if (!destUrl) {
			console.log(`🆕 Creating new "${sharing}" playlist...`);
			destination = await createPlaylist(source.title + ' (Copy)', sourceTracks, sharing);
			if (verbose) {
				sourceTracks.forEach((t) => console.log(`+ ${t.title} by ${t.user.username}`));
			}
		} else {
			const dest = await resolvePlaylist(destUrl);
			destination = await updatePlaylist(dest.id, sourceTracks, mode, verbose);
		}

		console.log(`✅ Done! "${destination.title}" has ${destination.tracks.length} track(s).`);
	} catch (err) {
		console.error('❌ Error:', err.response?.data || err.message);
	}
};

main();
