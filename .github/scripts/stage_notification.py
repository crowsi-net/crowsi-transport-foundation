"""Bind npm's stage response to a prepared archive; never approve a publication."""
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import quote


def notification(receipt, response, run_id, batch=''):
    for field, pattern in {
        'repository': r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',
        'source': r'[a-f0-9]{40}', 'sha256': r'[a-f0-9]{64}',
        'name': r'(?:@[a-z0-9_.-]+/)?[a-z0-9_.-]+',
        'version': r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[A-Za-z0-9.-]+)?',
    }.items():
        if not isinstance(receipt.get(field), str) or not re.fullmatch(pattern, receipt[field]):
            raise ValueError('Invalid prepared receipt: ' + field)
    if receipt.get('ecosystem') != 'npm' or not re.fullmatch(r'[1-9][0-9]*', run_id):
        raise ValueError('npm source run required')
    if batch and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}', batch):
        raise ValueError('Invalid approval batch identifier')
    if isinstance(response, list) and len(response) == 1:
        response = response[0]
    # npm's buffered JSON renderer may wrap the result by package name.
    if isinstance(response, dict) and set(response) == {receipt['name']}:
        response = response[receipt['name']]
    if not isinstance(response, dict):
        raise ValueError('Exactly one stage response required')
    for field in ['name', 'version', 'integrity']:
        if response.get(field) != receipt.get(field) or not receipt.get(field):
            raise ValueError('Stage response differs from prepared archive: ' + field)
    stage_id = response.get('stageId', '')
    if not isinstance(stage_id, str) or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', stage_id):
        raise ValueError('Exact npm stage ID required')
    # Deliberate allowlist: CLI output can also contain arbitrary package metadata.
    return {**{key: receipt[key] for key in ['repository', 'source', 'name', 'version', 'sha256', 'integrity']},
        'stageId': stage_id, 'state': 'submitted', 'approvalMode': 'batch' if batch else 'individual',
        'approvalBatch': batch or None,
        'npmUrl': 'https://www.npmjs.com/package/' + quote(receipt['name'], safe='@/'),
        'ciUrl': 'https://github.com/' + receipt['repository'] + '/actions/runs/' + run_id}


def markdown(items):
    if not 1 <= len(items) <= 100:
        raise ValueError('Bounded approval list required')
    if len({i['stageId'] for i in items}) != len(items):
        raise ValueError('Duplicate stage ID')
    if len(items) > 1 and (not items[0]['approvalBatch'] or
            any(i['approvalBatch'] != items[0]['approvalBatch'] for i in items)):
        raise ValueError('All grouped entries must belong to the same explicit batch')
    lines = ['# npm stage review', '',
        'Uploaded by GitHub CI; formal publication still requires maintainer approval in npm.',
        'Submission does not establish npm validation completion. Open npm and check the Staged Packages tab.',
        'Batch mode groups these exact candidates for review; it never bypasses npm 2FA or approves future versions.', '']
    for item in items:
        lines += [f"<!-- npm-stage:{item['stageId']} -->",
            f"- Package: `{item['name']}@{item['version']}`",
            f"- npm review entry: [package / Staged Packages]({item['npmUrl']})",
            f"- Stage ID: `{item['stageId']}`",
            f"- Archive SHA256: `{item['sha256']}`",
            f"- Source: `{item['source']}`",
            f"- Source/build CI: [run]({item['ciUrl']})",
            f"- Review mode: `{item['approvalMode']}`; batch: `{item['approvalBatch'] or 'none'}`", '']
    return '\n'.join(lines) + '\n'


def main():
    if sys.argv[1] == 'group':
        batch, destination, *paths = sys.argv[2:]
        if not 1 <= len(paths) <= 100:
            raise ValueError('Select 1 to 100 exact stage receipts')
        items = []
        for name in paths:
            path = Path(name)
            if path.stat().st_size > 16384:
                raise ValueError('Bounded stage receipt required')
            item = json.loads(path.read_text())
            match = re.fullmatch(r'https://github\.com/([^/]+/[^/]+)/actions/runs/([1-9][0-9]*)', item['ciUrl'])
            if not match or match[1] != item['repository'] or item.get('approvalBatch') != batch:
                raise ValueError('Stage source run or explicit group differs')
            items.append(notification({**item, 'ecosystem': 'npm'},
                {**item, 'stageId': item['stageId']}, match[2], batch))
        # A grouped review note has no authority to publish or approve any entry.
        with Path(destination).open('x') as output:
            output.write(markdown(items))
        return
    directory, response_path = map(Path, sys.argv[1:])
    if response_path.stat().st_size > 4 * 1024 ** 2:
        raise ValueError('Bounded stage response required')
    item = notification(json.loads((directory / 'release-receipt.json').read_text()),
        json.loads(response_path.read_text()), os.environ['GITHUB_RUN_ID'],
        os.environ.get('APPROVAL_BATCH', ''))
    folder = directory / 'stage-notification'
    folder.mkdir()
    (folder / 'stage-receipt.json').write_text(json.dumps(item, indent=2) + '\n')
    text = markdown([item])
    (folder / 'notice.md').write_text(text)
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
        output.write(text)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('stage-id=' + item['stageId'] + '\n')


if __name__ == '__main__':
    main()
