// "Card Mark": FF Mark for the printed card text. It's a licensed typeface, so it's never bundled or
// published. It comes from a copy installed on this device, or a font file the person loads; either
// stays in their browser. One file covers every weight, so nothing is faux-bolded.
const FAMILY = 'Card Mark'
const LOCAL_NAMES = ['FF Mark', 'FF Mark Pro', 'Mark Pro', 'MarkPro', 'Mark For MC', 'MarkForMC', 'FFMark']

let registered: FontFace | null = null

function register(face: FontFace) {
  if (registered) document.fonts.delete(registered)
  document.fonts.add(face)
  registered = face
}

// Try an installed copy. Safari only lets pages use system fonts, so this works in Chrome and Firefox.
export async function useInstalledMark(): Promise<boolean> {
  if (registered) return true
  try {
    const face = new FontFace(FAMILY, LOCAL_NAMES.map(n => `local("${n}")`).join(', '), { weight: '100 900' })
    register(await face.load())
    return true
  } catch {
    return false
  }
}

export async function useMarkFile(file: File): Promise<void> {
  const face = new FontFace(FAMILY, await file.arrayBuffer(), { weight: '100 900' })
  register(await face.load())
}

export function clearMark() {
  if (registered) document.fonts.delete(registered)
  registered = null
}
