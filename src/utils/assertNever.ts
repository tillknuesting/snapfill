// Compile-time exhaustiveness check for discriminated unions. Pass the
// "impossible" value at the end of an if-else / switch chain — TypeScript
// will fail the build if any variant is left unhandled.
export function assertNever(value: never, message?: string): never {
  throw new Error(
    message ?? `Unhandled discriminated union variant: ${JSON.stringify(value)}`,
  )
}
