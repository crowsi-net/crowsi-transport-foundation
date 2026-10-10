/** Exit once on an explicit test interruption; new requests use a new process. */
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  const value: unknown = JSON.parse(chunk);
  if (value !== null && typeof value === 'object' && 'interrupt' in value && value.interrupt) process.exit(7);
  else process.stdout.write(JSON.stringify(value) + '\n');
});
