import type { Content, ListItem, Root } from 'mdast'

/**
 * Canvas / LMS exports often use top-level `-` bullets and `1.` sublists without the 4-space
 * indent CommonMark requires. The parser then emits sibling <ol>, <ul>, <ol> instead of nesting.
 *
 * Remark stores ordered-list markers on list nodes as `start`, not in the list item paragraph
 * text, so merges must use `start` rather than matching "2." in plain text.
 */
export function remarkMergeAdjacentLists() {
  return (tree: Root) => {
    walk(tree)
  }
}

type Parent = Root | ListItem | { type: 'blockquote'; children: Content[] }

function mergeSiblingLists(parent: Parent) {
  let changed = true
  while (changed) {
    changed = false
    const { children } = parent
    for (let i = 0; i < children.length - 1; i++) {
      const a = children[i]
      const b = children[i + 1]
      if (a?.type !== 'list' || b?.type !== 'list') continue

      // <ol> then <ul> → nest ul inside last <li> of the ol
      if (a.ordered && !b.ordered) {
        const lastLi = a.children[a.children.length - 1] as ListItem | undefined
        if (lastLi) {
          lastLi.children.push(b)
          children.splice(i + 1, 1)
          changed = true
          break
        }
      }

      if (a.ordered && b.ordered) {
        const lastLi = a.children[a.children.length - 1] as ListItem | undefined
        if (!lastLi) continue

        const bStart = b.start ?? 1

        // Continuation: next ordered block is item 2+ after a single top-level <li>
        if (bStart === 2 && a.children.length === 1) {
          a.children.push(...b.children)
          children.splice(i + 1, 1)
          changed = true
          break
        }

        // Nested <ol start="1"> under the previous item (e.g. steps under item 2)
        if (bStart === 1 && a.children.length >= 2) {
          lastLi.children.push(b)
          children.splice(i + 1, 1)
          changed = true
          break
        }
      }
    }
  }
}

function walk(parent: Parent) {
  mergeSiblingLists(parent)
  for (const child of parent.children) {
    if (child.type === 'listItem') {
      walk(child)
    }
    if (child.type === 'blockquote') {
      walk(child)
    }
    if (child.type === 'list') {
      for (const li of child.children) {
        walk(li)
      }
    }
  }
}
