export function isExCommand(cmd: string): boolean {
  return cmd.startsWith(':');
}

export function stripColonPrefix(cmd: string): string {
  return cmd.startsWith(':') ? cmd.substring(1) : cmd;
}
