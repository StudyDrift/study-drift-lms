export const getEnv = (key: string, required?: boolean) => {
  if (!process.env[key] && required) {
    throw new Error(`Missing environment variable: ${key}`)
  }

  if (required) {
    return process.env[key] + ""
  }

  return process.env[key]
}
