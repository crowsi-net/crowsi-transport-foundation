/** Test-only JSONL echo process; never interprets application authority. */
process.stdin.setEncoding('utf8');
let buffered = '';
process.stdin.on('data', (chunk: string) => {
  buffered += chunk;
  let end: number;
  while ((end = buffered.indexOf('\n')) >= 0) {
    const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
    process.stdout.write(line + '\n');
  }
});
