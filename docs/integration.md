# Portfolio integration

Build with `npm run build` and upload the contents of `dist/` to a directory such as `/tools/ascii-catalyst/`. The app uses relative assets and hash-based workspaces, so direct routes such as `/tools/ascii-catalyst/#output` require the static directory and its default `index.html`. Canonicalize the directory route to a trailing slash.

Add a link from the portfolio’s Tools index.

    <a href="/tools/ascii-catalyst/">ASCII-Catalyst</a>

An iframe isolates styles and navigation. Grant camera access where the host should permit Live. The browser still asks the user for permission.

    <iframe
      title="ASCII-Catalyst"
      src="/tools/ascii-catalyst/"
      loading="lazy"
      allow="camera; clipboard-write"
      style="width:100%; min-height:760px; border:0">
    </iframe>

For cross-origin embedding, the host must also allow the app’s origin in its camera permissions policy if Live is needed. Browser privacy settings may partition or deny embedded IndexedDB.

The build reads `ASCII_REPOSITORY_URL` as an optional HTTPS repository URL and shows it in Studio settings. Customize the wordmark and navigation in `index.html` and design tokens in `src/styles.css`.

Exported HTML and SVG contain self-contained markup. Use PNG or WebP for thumbnails and transparent artwork, and JSON for interactive rendering of individual cells. The [engine reference](engine.md) includes a working API example.
