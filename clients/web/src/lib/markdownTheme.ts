import type { CSSProperties } from 'react'

/** Six built-in presets (plus `custom` stored on the course). */
export type MarkdownThemePresetId =
  | 'classic'
  | 'reader'
  | 'serif'
  | 'contrast'
  | 'night'
  | 'accent'

export type MarkdownThemePresetOrCustom = MarkdownThemePresetId | 'custom'

export type ArticleWidth = 'narrow' | 'comfortable' | 'wide' | 'full'

export type MarkdownThemeCustom = {
  headingColor?: string
  bodyColor?: string
  linkColor?: string
  codeBackground?: string
  blockquoteBorder?: string
  articleWidth?: ArticleWidth
  fontFamily?: 'sans' | 'serif'
}

export type ThemeClasses = {
  article: string
  h1: string
  h2: string
  h3: string
  p: string
  ul: string
  ol: string
  li: string
  a: string
  blockquote: string
  codeInline: string
  pre: string
  tableWrap: string
  table: string
  thead: string
  th: string
  td: string
  hr: string
}

export type ElementStyleOverrides = Partial<{
  h1: CSSProperties
  h2: CSSProperties
  h3: CSSProperties
  p: CSSProperties
  ul: CSSProperties
  ol: CSSProperties
  li: CSSProperties
  a: CSSProperties
  blockquote: CSSProperties
  codeInline: CSSProperties
  pre: CSSProperties
  table: CSSProperties
  thead: CSSProperties
  th: CSSProperties
  td: CSSProperties
  hr: CSSProperties
}>

export type ResolvedMarkdownTheme = {
  classes: ThemeClasses
  styleOverrides: ElementStyleOverrides
}

const WIDTH_MAX: Record<ArticleWidth, string> = {
  narrow: 'max-w-xl',
  comfortable: 'max-w-3xl',
  wide: 'max-w-4xl',
  full: 'max-w-full',
}

/** Keeps reading width bounded and centered in the viewport for every preset. */
const ARTICLE_CENTER = 'mx-auto w-full min-w-0'

const PRESET_CLASSES: Record<MarkdownThemePresetId, ThemeClasses> = {
  classic: {
    article: `${ARTICLE_CENTER} max-w-3xl`,
    h1: 'mt-8 text-2xl font-bold tracking-tight text-slate-900 first:mt-0',
    h2: 'mt-8 text-xl font-semibold tracking-tight text-slate-900 first:mt-0',
    h3: 'mt-6 text-lg font-semibold text-slate-900 first:mt-0',
    p: 'mt-4 text-[15px] leading-[1.65] text-slate-700 first:mt-0',
    ul: 'mt-4 list-disc space-y-2 pl-5 text-[15px] leading-[1.65] text-slate-700',
    ol: 'mt-4 list-decimal space-y-2 pl-5 text-[15px] leading-[1.65] text-slate-700',
    li: 'marker:text-slate-500',
    a: 'font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-2 hover:text-indigo-500',
    blockquote: 'mt-4 border-l-4 border-slate-200 pl-4 text-slate-600 italic',
    codeInline: 'rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.9em] text-slate-800',
    pre: 'mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800',
    tableWrap: 'mt-4 overflow-x-auto rounded-xl border border-slate-200',
    table: 'w-full min-w-[20rem] border-collapse text-left text-sm text-slate-800',
    thead: 'bg-slate-50 text-slate-900',
    th: 'border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide',
    td: 'border-b border-slate-100 px-3 py-2 align-top',
    hr: 'my-8 border-slate-200',
  },
  reader: {
    article: `${ARTICLE_CENTER} max-w-4xl rounded-2xl bg-stone-50 px-6 py-8 ring-1 ring-stone-200/80 sm:px-10`,
    h1: 'mt-8 text-3xl font-semibold tracking-tight text-stone-900 first:mt-0',
    h2: 'mt-10 text-2xl font-semibold tracking-tight text-stone-900 first:mt-0',
    h3: 'mt-8 text-xl font-medium text-stone-800 first:mt-0',
    p: 'mt-4 text-[17px] leading-[1.75] text-stone-700 first:mt-0',
    ul: 'mt-4 list-disc space-y-2 pl-6 text-[17px] leading-[1.75] text-stone-700',
    ol: 'mt-4 list-decimal space-y-2 pl-6 text-[17px] leading-[1.75] text-stone-700',
    li: 'marker:text-stone-400',
    a: 'font-medium text-amber-800 underline decoration-amber-200 underline-offset-4 hover:text-amber-900',
    blockquote: 'mt-6 border-l-[3px] border-amber-300/80 bg-amber-50/50 py-1 pl-5 text-stone-700 not-italic',
    codeInline: 'rounded-md bg-stone-200/80 px-1.5 py-0.5 font-mono text-[0.88em] text-stone-900',
    pre: 'mt-6 overflow-x-auto rounded-lg border border-stone-200 bg-white p-5 text-[15px] text-stone-800 shadow-sm',
    tableWrap: 'mt-6 overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm',
    table: 'w-full min-w-[20rem] border-collapse text-left text-[15px] text-stone-800',
    thead: 'bg-stone-100 text-stone-900',
    th: 'border-b border-stone-200 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide',
    td: 'border-b border-stone-100 px-3 py-2.5 align-top',
    hr: 'my-10 border-stone-200',
  },
  serif: {
    article: `${ARTICLE_CENTER} max-w-3xl font-serif`,
    h1: 'mt-8 text-3xl font-bold tracking-tight text-stone-900 first:mt-0',
    h2: 'mt-8 text-2xl font-semibold text-stone-900 first:mt-0',
    h3: 'mt-6 text-xl font-semibold text-stone-800 first:mt-0',
    p: 'mt-4 text-[16px] leading-relaxed text-stone-800 first:mt-0',
    ul: 'mt-4 list-disc space-y-2 pl-6 text-[16px] leading-relaxed text-stone-800',
    ol: 'mt-4 list-decimal space-y-2 pl-6 text-[16px] leading-relaxed text-stone-800',
    li: 'marker:text-amber-700/60',
    a: 'font-medium text-amber-900 underline decoration-amber-300 underline-offset-2 hover:text-amber-950',
    blockquote: 'mt-5 border-l-4 border-amber-800/25 pl-5 text-stone-700 italic',
    codeInline: 'rounded bg-amber-100/80 px-1.5 py-0.5 font-mono text-[0.85em] text-stone-900',
    pre: 'mt-5 overflow-x-auto rounded-lg border border-stone-300 bg-amber-50/40 p-4 text-sm text-stone-900',
    tableWrap: 'mt-5 overflow-x-auto rounded-lg border border-stone-300',
    table: 'w-full min-w-[20rem] border-collapse text-left text-sm text-stone-900',
    thead: 'bg-stone-100',
    th: 'border-b border-stone-300 px-3 py-2 text-xs font-semibold uppercase tracking-wider',
    td: 'border-b border-stone-200 px-3 py-2 align-top',
    hr: 'my-8 border-stone-300',
  },
  contrast: {
    article: `${ARTICLE_CENTER} max-w-3xl border border-slate-900 bg-white p-6 sm:p-8`,
    h1: 'mt-6 text-2xl font-black uppercase tracking-tight text-black first:mt-0',
    h2: 'mt-10 text-xl font-bold uppercase tracking-wide text-black first:mt-0',
    h3: 'mt-8 text-lg font-bold text-black first:mt-0',
    p: 'mt-3 text-[15px] font-medium leading-relaxed text-black first:mt-0',
    ul: 'mt-3 list-disc space-y-1.5 pl-5 text-[15px] font-medium leading-relaxed text-black',
    ol: 'mt-3 list-decimal space-y-1.5 pl-5 text-[15px] font-medium leading-relaxed text-black',
    li: 'marker:text-black',
    a: 'font-bold text-black underline decoration-2 underline-offset-4 hover:bg-yellow-200',
    blockquote: 'mt-4 border-l-8 border-black bg-slate-100 py-2 pl-4 font-semibold text-black',
    codeInline: 'border border-black bg-white px-1.5 py-0.5 font-mono text-[0.9em] text-black',
    pre: 'mt-4 overflow-x-auto border-2 border-black bg-white p-4 text-sm font-medium text-black',
    tableWrap: 'mt-4 overflow-x-auto border-2 border-black',
    table: 'w-full min-w-[20rem] border-collapse border border-black text-left text-sm text-black',
    thead: 'bg-black text-white',
    th: 'border border-black px-3 py-2 text-xs font-bold uppercase',
    td: 'border border-black px-3 py-2 align-top',
    hr: 'my-8 border-t-2 border-black',
  },
  night: {
    article: `${ARTICLE_CENTER} max-w-3xl rounded-2xl bg-slate-900 px-6 py-8 text-slate-100 shadow-xl ring-1 ring-slate-700 sm:px-8`,
    h1: 'mt-6 text-2xl font-bold tracking-tight text-white first:mt-0',
    h2: 'mt-8 text-xl font-semibold tracking-tight text-slate-100 first:mt-0',
    h3: 'mt-6 text-lg font-semibold text-slate-200 first:mt-0',
    p: 'mt-3 text-[15px] leading-relaxed text-slate-300 first:mt-0',
    ul: 'mt-3 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-slate-300',
    ol: 'mt-3 list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed text-slate-300',
    li: 'marker:text-slate-500',
    a: 'font-medium text-sky-400 underline decoration-sky-600 underline-offset-2 hover:text-sky-300',
    blockquote: 'mt-4 border-l-4 border-slate-600 pl-4 text-slate-400 italic',
    codeInline: 'rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[0.9em] text-slate-100',
    pre: 'mt-4 overflow-x-auto rounded-xl border border-slate-700 bg-slate-950 p-4 text-sm text-slate-200',
    tableWrap: 'mt-4 overflow-x-auto rounded-xl border border-slate-700',
    table: 'w-full min-w-[20rem] border-collapse text-left text-sm text-slate-200',
    thead: 'bg-slate-800 text-slate-100',
    th: 'border-b border-slate-600 px-3 py-2 text-xs font-semibold uppercase tracking-wide',
    td: 'border-b border-slate-700 px-3 py-2 align-top text-slate-300',
    hr: 'my-8 border-slate-700',
  },
  accent: {
    article: `${ARTICLE_CENTER} max-w-3xl`,
    h1: 'mt-8 text-2xl font-bold tracking-tight text-violet-950 first:mt-0',
    h2: 'mt-8 text-xl font-semibold tracking-tight text-violet-900 first:mt-0',
    h3: 'mt-6 text-lg font-semibold text-violet-900 first:mt-0',
    p: 'mt-3 text-[15px] leading-relaxed text-slate-700 first:mt-0',
    ul: 'mt-3 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-slate-700',
    ol: 'mt-3 list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed text-slate-700',
    li: 'marker:text-violet-400',
    a: 'font-medium text-emerald-700 underline decoration-emerald-200 underline-offset-2 hover:text-emerald-800',
    blockquote: 'mt-4 border-l-4 border-violet-400 bg-violet-50/80 py-1 pl-4 text-violet-950',
    codeInline: 'rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[0.9em] text-emerald-950',
    pre: 'mt-4 overflow-x-auto rounded-xl border border-violet-200 bg-violet-50/50 p-4 text-sm text-violet-950',
    tableWrap: 'mt-4 overflow-x-auto rounded-xl border border-violet-200',
    table: 'w-full min-w-[20rem] border-collapse text-left text-sm text-violet-950',
    thead: 'bg-violet-100/80 text-violet-950',
    th: 'border-b border-violet-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide',
    td: 'border-b border-violet-100 px-3 py-2 align-top',
    hr: 'my-8 border-violet-200',
  },
}

const CUSTOM_DEFAULTS: Required<
  Pick<
    MarkdownThemeCustom,
    | 'headingColor'
    | 'bodyColor'
    | 'linkColor'
    | 'codeBackground'
    | 'blockquoteBorder'
    | 'articleWidth'
    | 'fontFamily'
  >
> = {
  headingColor: '#0f172a',
  bodyColor: '#334155',
  linkColor: '#4f46e5',
  codeBackground: '#f1f5f9',
  blockquoteBorder: '#e2e8f0',
  articleWidth: 'comfortable',
  fontFamily: 'sans',
}

/** Default custom theme values for the branding form and API seeding. */
export const markdownThemeCustomSeed: MarkdownThemeCustom = { ...CUSTOM_DEFAULTS }

/** Inline colors when the LMS shell is dark — custom branding defaults assume a light page. */
const CUSTOM_INLINE_COLORS_DARK_LMS: Pick<
  MarkdownThemeCustom,
  'headingColor' | 'bodyColor' | 'linkColor' | 'codeBackground' | 'blockquoteBorder'
> = {
  headingColor: '#f1f5f9',
  bodyColor: '#cbd5e1',
  linkColor: '#a5b4fc',
  codeBackground: '#1e293b',
  blockquoteBorder: '#475569',
}

function mergeCustom(
  base: ThemeClasses,
  c: MarkdownThemeCustom,
  lmsUiDark?: boolean,
): { classes: ThemeClasses; overrides: ElementStyleOverrides } {
  const m = {
    ...CUSTOM_DEFAULTS,
    ...c,
    ...(lmsUiDark ? CUSTOM_INLINE_COLORS_DARK_LMS : {}),
  }
  const maxW = WIDTH_MAX[m.articleWidth]
  const font = m.fontFamily === 'serif' ? 'font-serif' : 'font-sans'

  const classes: ThemeClasses = {
    ...base,
    article: `${ARTICLE_CENTER} ${maxW} ${font}`.trim(),
    h1: `${base.h1} ${font}`,
    h2: `${base.h2} ${font}`,
    h3: `${base.h3} ${font}`,
    p: `${base.p} ${font}`,
    ul: `${base.ul} ${font}`,
    ol: `${base.ol} ${font}`,
    li: `${base.li} ${font}`,
    blockquote: `${base.blockquote} ${font}`,
  }

  const overrides: ElementStyleOverrides = {
    h1: { color: m.headingColor },
    h2: { color: m.headingColor },
    h3: { color: m.headingColor },
    p: { color: m.bodyColor },
    ul: { color: m.bodyColor },
    ol: { color: m.bodyColor },
    li: { color: m.bodyColor },
    a: { color: m.linkColor },
    blockquote: { borderLeftColor: m.blockquoteBorder, color: m.bodyColor },
    codeInline: { backgroundColor: m.codeBackground, color: m.headingColor },
    pre: { backgroundColor: m.codeBackground, color: m.headingColor, borderColor: m.blockquoteBorder },
    table: { borderColor: m.blockquoteBorder },
    thead: { color: m.headingColor },
    th: { color: m.headingColor, borderColor: m.blockquoteBorder },
    td: { color: m.bodyColor, borderColor: m.blockquoteBorder },
    hr: { borderColor: m.blockquoteBorder },
  }

  return { classes, overrides }
}

/** Reading surface when the LMS shell is dark — dark panel (no white flash). */
const LMS_DARK_READING_SURFACE =
  'rounded-2xl border border-slate-700/90 !bg-slate-950/95 px-6 py-8 shadow-sm ring-1 ring-slate-700/70'

function effectiveMarkdownPresetId(preset: string): MarkdownThemePresetId | 'custom' {
  if (preset === 'custom') return 'custom'
  const pid = preset as MarkdownThemePresetId
  return pid in PRESET_CLASSES ? pid : 'classic'
}

function articleSurfaceForLmsDark(
  effective: MarkdownThemePresetId | 'custom',
  _articleClass: string,
  lmsUiDark: boolean,
): string {
  if (!lmsUiDark) return ''
  if (effective === 'night' || effective === 'contrast') return ''
  if (
    effective === 'reader' ||
    effective === 'custom' ||
    effective === 'classic' ||
    effective === 'serif' ||
    effective === 'accent'
  ) {
    return LMS_DARK_READING_SURFACE
  }
  return ''
}

export type ResolveMarkdownThemeOptions = {
  /** When true, adjust article chrome so course branding stays readable on the dark LMS shell. */
  lmsUiDark?: boolean
}

/** Resolves API fields into classes + optional inline colors for custom themes. */
export function resolveMarkdownTheme(
  preset: string,
  custom: MarkdownThemeCustom | null | undefined,
  options?: ResolveMarkdownThemeOptions,
): ResolvedMarkdownTheme {
  const lmsUiDark = options?.lmsUiDark === true
  let resolved: ResolvedMarkdownTheme

  if (preset === 'custom') {
    const { classes, overrides } = mergeCustom(PRESET_CLASSES.classic, custom ?? {}, lmsUiDark)
    resolved = { classes, styleOverrides: overrides }
  } else {
    const pid = preset as MarkdownThemePresetId
    if (pid in PRESET_CLASSES) {
      resolved = { classes: PRESET_CLASSES[pid], styleOverrides: {} }
    } else {
      resolved = { classes: PRESET_CLASSES.classic, styleOverrides: {} }
    }
  }

  const effective = effectiveMarkdownPresetId(preset)
  const extra = articleSurfaceForLmsDark(effective, resolved.classes.article, lmsUiDark)
  if (!extra) return resolved

  return {
    ...resolved,
    classes: {
      ...resolved.classes,
      article: `${resolved.classes.article} ${extra}`.trim(),
    },
  }
}

export const MARKDOWN_THEME_PRESET_META: {
  id: MarkdownThemePresetId
  title: string
  description: string
}[] = [
  { id: 'classic', title: 'Classic', description: 'Balanced slate tones and indigo links.' },
  { id: 'reader', title: 'Reader', description: 'Wide, warm page with comfortable line length.' },
  { id: 'serif', title: 'Academic', description: 'Serif type and traditional emphasis.' },
  { id: 'contrast', title: 'Contrast', description: 'High contrast for clarity and focus.' },
  { id: 'night', title: 'Night', description: 'Dark canvas for low-glare reading.' },
  { id: 'accent', title: 'Accent', description: 'Violet headings with emerald links.' },
]
