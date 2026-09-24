// The window event that opens the command palette from a button (the mobile
// bar's search icon), alongside the ⌘K shortcut. Its own module so the nav
// can import the name without pulling in the palette itself.
export const OPEN_SEARCH_EVENT = "vc:open-search";
