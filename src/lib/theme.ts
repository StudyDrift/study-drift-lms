import { ColorScheme } from "@/models/user-settings.model"

export const DARK_THEME = {
  component: {
    defaultProps: {},
    valid: {},
    styles: {},
  },
}
export const LIGHT_THEME = {
  button: {
    styles: {},
  },
}

export const THEMES: Record<ColorScheme, object> = {
  [ColorScheme.Dark]: DARK_THEME,
  [ColorScheme.Light]: LIGHT_THEME,
  [ColorScheme.System]: {},
}
