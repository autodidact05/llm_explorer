/** Mirrors backend ``image_gen_constants.detect_image_generation_intent`` for UI hints. */

const IMAGE_NOUNS =
  '(?:image|picture|photo|photograph|illustration|artwork|painting|wallpaper|logo|banner|graphic|visual|portrait|landscape|drawing|sketch)'
const ART = '(?:a|an|the|my|your|me|us|one|some|this|that)\\s+'

const IMAGE_INTENT_RE = new RegExp(
  '(?:'
  + `\\b(?:draw|paint|sketch|illustrate|render)\\b\\s+${ART}\\w`
  + `|\\b(?:generate|create|make|produce|design)\\b[^.!?\\n]{0,80}?${IMAGE_NOUNS}`
  + `|\\b(?:show|give)\\s+me\\b[^.!?\\n]{0,50}?${IMAGE_NOUNS}`
  + ')',
  'i',
)

export function looksLikeImageGenerationIntent(content: string): boolean {
  return IMAGE_INTENT_RE.test(content)
}
