---
name: Vite HTML metadata
description: Vite production builds can treat root-relative link URLs in index.html as local assets.
---

Keep deployment-specific canonical and social URLs runtime-generated when the Vite app can be deployed under different hosts.

**Why:** A root-relative `link` URL such as `/` can be passed through Vite's HTML asset pipeline and fail with an `EISDIR` build error instead of remaining a browser URL.

**How to apply:** Prefer runtime metadata updates from `window.location.origin` for canonical, Open Graph, and Twitter URLs. Keep static HTML metadata host-neutral and avoid root-relative `link` asset references that Vite will try to read during production builds.