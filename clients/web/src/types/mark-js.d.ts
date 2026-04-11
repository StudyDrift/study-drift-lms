declare module 'mark.js' {
  type MarkOptions = {
    className?: string
    acrossElements?: boolean
    separateWordSearch?: boolean
    diacritics?: boolean
    accuracy?: 'partially' | 'complementary' | 'exactly'
    each?: (element: Element) => void
  }

  export default class Mark {
    constructor(ctx: HTMLElement | ReadonlyArray<HTMLElement>)
    mark(term: string | readonly string[], options?: MarkOptions): void
    unmark(options?: { done?: () => void }): void
  }
}
