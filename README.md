# 🎵 SoundCloud Playlist Downloader

A CLI tool to download and cache SoundCloud playlist tracks using `yt-dlp`.

---

## 🚀 Features

- 🔄 Downloads all tracks from a SoundCloud playlist  
- 💾 Caches downloaded tracks per playlist (in `.cache/`)  
- 🧠 Skips tracks already downloaded  
- ⏱️ Skips tracks longer than a max duration (default: 20 minutes)  
- 🧹 Cleans up non-MP3 files in the download folder  
- 📊 CLI progress bar with live spinner animation

---

## 🛠 Requirements

- Node.js (v18+)  
- `yt-dlp` installed and accessible from your terminal (`brew install yt-dlp`, `pip install yt-dlp`, etc.)

---

## 📦 Installation

Clone the repo and install dependencies:

```bash
git clone https://github.com/yourname/soundcloud-playlist-downloader.git
cd soundcloud-playlist-downloader
npm install
```

---

## ⚙️ Usage

Basic example:

```bash
node downloader.js --url https://soundcloud.com/user/sets/playlist-name
```

### 🧩 Options

| Option           | Description                                 |
|------------------|---------------------------------------------|
| `--url, -u`       | ✅ Required: one or more SoundCloud playlist URLs |
| `--folder, -f`    | Output folder name override (optional)      |
| `--max-duration, -d` | Max track length in minutes (default: 20)     |
| `--clear-cache`   | Wipes the cache before downloading (optional) |

📝 **Note:** Multiple playlists can be separated with commas.

---

## 📚 Example

```bash
node downloader.js -u "https://soundcloud.com/user/sets/mix1" -f "MyMixes" -d 15 --clear-cache
```

- Downloads one playlist into `output/MyMixes`
- Skips tracks longer than 15 minutes
- Clears cache before downloading

---

🎉 Happy listening!
