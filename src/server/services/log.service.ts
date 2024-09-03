export const logService = {
  warn: (message: string, ...args: any[]) => console.warn(message, ...args),
  error: (message: string, ...args: any[]) => console.error(message, ...args),
  info: (message: string, ...args: any[]) => console.info(message, ...args),
  debug: (message: string, ...args: any[]) => console.debug(message, ...args),
}
