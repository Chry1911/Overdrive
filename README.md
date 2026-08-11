# Overdrive

Desktop app nativa per Windows 11 (Tauri + React + Rust) per ottimizzazione gaming:
- monitoraggio processi in tempo reale
- Gaming Mode one-click
- power plan (Balanced / High / Ultimate)
- tweak registro whitelist con backup
- pulizia file temporanei selezionati

[![Latest Release](https://img.shields.io/github/v/release/Chry1911/Overdrive?display_name=tag)](https://github.com/Chry1911/Overdrive/releases/latest)
[![Download EXE](https://img.shields.io/badge/Download-EXE-blue?logo=windows)](https://github.com/Chry1911/Overdrive/releases/latest)
[![Install with winget](https://img.shields.io/badge/winget-install-Chris.Overdrive-0078D4?logo=windows)](#installazione-con-winget)

## Installazione con winget

Comando:

```powershell
winget install --id Chris.Overdrive -e --source winget
```

Nota: GitHub non permette un pulsante che esegue comandi locali per sicurezza. Il badge sopra porta alla sezione con il comando pronto da copiare.

## Download installer manuale

Dalla release scarica:
- `overdrive_0.1.0_x64-setup.exe` (NSIS)
- `overdrive_0.1.0_x64_en-US.msi` (MSI)
- `SHA256SUMS.txt`

## Sviluppo locale

Prerequisiti:
1. Rust stable msvc
2. Node.js 18+
3. Visual Studio Build Tools (Desktop development with C++)
4. WebView2 runtime

Comandi:

```powershell
npm install
npm run tauri dev
```

## Build release

```powershell
npm run tauri build
```

Output:
- `src-tauri/target/release/bundle/nsis/overdrive_0.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/overdrive_0.1.0_x64_en-US.msi`

## Pubblicazione release GitHub

1. `git push origin main`
2. `git tag -a v0.1.0 -m "Overdrive v0.1.0"`
3. `git push origin v0.1.0`
4. Crea release su `v0.1.0` oppure usa `gh release create`

Upload manuale assets esistenti:

```powershell
gh release upload v0.1.0 src-tauri/target/release/bundle/nsis/overdrive_0.1.0_x64-setup.exe src-tauri/target/release/bundle/msi/overdrive_0.1.0_x64_en-US.msi --clobber
```

## Perche vedi solo "Source code" nella release

Succede quando:
1. La release viene creata ma nessun asset viene allegato.
2. Il workflow di release non e nel repository corretto.
3. Il workflow non ha permesso `contents: write`.

Il workflow corretto e in `.github/workflows/release-tauri.yml`.
