# cards

A studio for rendering payment card mockups in 3D: design the front and back, pick a finish, light it, pose it, and export a PNG or JPG at HD or 4K.

- Drag to turn and tilt, shift-drag to roll, alt or right-drag to pan, scroll or pinch to zoom, double-tap to reset. In multi-card layouts, drag a card to move it.
- The renderer (`src/engine/studio.ts`) is the original Card studio three.js engine, kept as plain JS behind a small API. The UI is React on [veryrobert/starter](https://github.com/veryrobert/starter).
- Options are remembered between visits.

```bash
npm install
npm run dev
```
