import copy
import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).parent))
from stage_notification import notification, markdown

RECEIPT = {'repository': 'fixture/repo', 'source': 'a' * 40, 'sha256': 'b' * 64,
    'ecosystem': 'npm', 'name': '@fixture/package', 'version': '0.1.0', 'integrity': 'sha512-fixture'}
RESPONSE = {'name': '@fixture/package', 'version': '0.1.0', 'integrity': 'sha512-fixture',
    'stageId': '11111111-2222-3333-4444-555555555555', 'token': 'DO-NOT-EMIT',
    'files': [{'path': 'DO-NOT-EMIT'}]}


class StageNotificationTests(unittest.TestCase):
    def test_submission_is_not_approval_or_validation_completion(self):
        item = notification(RECEIPT, RESPONSE, '123')
        self.assertEqual(item['state'], 'submitted')
        self.assertEqual(item['approvalMode'], 'individual')
        rendered = markdown([item])
        self.assertIn('does not establish npm validation completion', rendered)
        self.assertNotIn('DO-NOT-EMIT', rendered + str(item))

    def test_identity_bytes_and_stage_id_must_match(self):
        for field in ['name', 'version', 'integrity', 'stageId']:
            with self.assertRaises(ValueError):
                notification(RECEIPT, {**RESPONSE, field: 'changed'}, '123')
        for field in ['repository', 'source', 'sha256', 'name', 'version']:
            with self.assertRaises(ValueError):
                notification({**RECEIPT, field: 'bad\ninput'}, RESPONSE, '123')

    def test_npm_buffered_object_and_single_array_forms_match_without_accepting_other_packages(self):
        expected = notification(RECEIPT, RESPONSE, '123')
        self.assertEqual(notification(RECEIPT, {RECEIPT['name']: RESPONSE}, '123'), expected)
        self.assertEqual(notification(RECEIPT, [RESPONSE], '123'), expected)
        for result in [{RECEIPT['name']:RESPONSE,'other':RESPONSE}, [RESPONSE, RESPONSE]]:
            with self.assertRaises(ValueError): notification(RECEIPT, result, '123')

    def test_batch_requires_explicit_same_group_and_unique_candidates(self):
        first = notification(RECEIPT, RESPONSE, '123', 'migration-20261014')
        second = copy.deepcopy(first)
        second['stageId'] = '22222222-2222-3333-4444-555555555555'
        self.assertIn('migration-20261014', markdown([first, second]))
        for changed in [None, 'different']:
            second['approvalBatch'] = changed
            with self.assertRaises(ValueError): markdown([first, second])
        with self.assertRaises(ValueError): markdown([first, first])
        with self.assertRaises(ValueError): notification(RECEIPT, RESPONSE, '123', 'bad\nidentifier')


if __name__ == '__main__': unittest.main()
