/**
 * Remove a leading byte-order mark. Windows editors such as Notepad often save
 * text with one, and it breaks `JSON.parse` and hides a frontmatter `---` fence.
 * Every reader of a user-editable file goes through this, so none can miss it.
 */
export function withoutByteOrderMark(text: string): string {
  return text.startsWith('﻿') ? text.slice(1) : text;
}
