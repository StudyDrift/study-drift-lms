import { ColorScheme } from "@/models/user-settings.model"

export const DARK_THEME = {
  card: {
    defaultProps: {
      color: "gray",
    },
  },
  select: {
    defaultProps: {
      color: "gray",
    },
    styles: {
      base: {
        select: {
          color: "text-gray-200",
        },
        label: {
          color: "text-gray-200",
        },
        menu: {
          color: "text-gray-200",
          bg: "bg-gray-800",
        },
        option: {
          initial: {
            background:
              "hover:bg-gray-900 hover:bg-opacity-80 focus:bg-gray-900 focus:bg-opacity-80 active:bg-gray-900 active:bg-opacity-80",
            color:
              "hover:text-gray-200 focus:text-gray-200 active:text-gray-200 text-gray-300",
          },
          active: {
            bg: "bg-gray-900 bg-opacity-80",
            color: "text-gray-200",
          },
        },
      },
    },
  },
  button: {
    defaultProps: {
      color: "white",
    },
  },
  iconButton: {
    defaultProps: {
      color: "white",
    },
  },
  list: {
    defaultProps: {
      ripple: false,
    },
    styles: {
      base: {
        item: {
          initial: {
            color:
              "hover:text-gray-200 focus:text-gray-200 active:text-gray-200 text-gray-300",
            bg: "hover:bg-gray-800 hover:bg-opacity-80 focus:bg-gray-800 focus:bg-opacity-80 active:bg-gray-800 active:bg-opacity-80",
          },
          active: { color: "text-gray-300" },
        },
      },
    },
  },
  input: {
    styles: {
      base: {
        input: {
          color: "text-gray-200",
        },
        label: {
          color: "text-gray-200",
        },
      },
    },
  },
  textarea: {
    styles: {
      base: {
        input: {
          color: "text-gray-200",
        },
        label: {
          color: "text-gray-200",
        },
      },
    },
  },
  accordion: {
    styles: {
      base: {
        header: {
          initial: {
            color: "text-blue-gray-200",
            hover: "hover:text-blue-gray-300",
            borderWidth: "border-b-none",
          },
          active: { color: "text-blue-gray-300" },
        },
        body: {
          color: "text-gray-200",
        },
      },
    },
  },
  dialog: {
    styles: {
      base: {
        container: {
          bg: "bg-gray-900",
          color: "text-gray-100",
        },
      },
    },
  },
  dialogHeader: {
    styles: {
      base: {
        color: "text-gray-100",
      },
    },
  },
  dialogBody: {
    styles: {
      base: {
        initial: {
          color: "text-gray-100",
        },
      },
    },
  },
  typography: {
    styles: {
      variants: {
        h1: {
          color: "text-gray-100",
        },
        h2: {
          color: "text-gray-100",
        },
        h3: {
          color: "text-gray-100",
        },
        h4: {
          color: "text-gray-100",
        },
        h5: {
          color: "text-gray-100",
        },
        h6: {
          color: "text-gray-100",
        },
        lead: {
          color: "text-gray-100",
        },
        paragraph: {
          color: "text-gray-100",
        },
        small: {
          color: "text-gray-100",
        },
      },
    },
  },
  menu: {
    styles: {
      base: {
        menu: {
          bg: "bg-gray-900",
          color: "text-gray-100",
        },
      },
    },
  },
}
export const LIGHT_THEME = {
  list: {
    defaultProps: {
      ripple: false,
    },
  },
  accordion: {
    styles: {
      base: {
        header: {
          initial: {
            borderWidth: "border-b-none",
          },
        },
      },
    },
  },
}

export const THEMES: Record<ColorScheme, object> = {
  [ColorScheme.Dark]: DARK_THEME,
  [ColorScheme.Light]: LIGHT_THEME,
  [ColorScheme.System]: {},
}
