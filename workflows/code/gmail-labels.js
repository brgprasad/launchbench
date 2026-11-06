// Gmail label IDs in the labs mailbox (teamlaunchbench@gmail.com), created by the
// one-off workflow "LB · setup Gmail labels (one-off)" (d7wbvnA6jmXYeaKQ) on
// 2026-11-06. Gmail's API labels messages by ID, not name, so the workflows use
// these IDs in their "Label ..." Gmail nodes. If the labels are ever recreated,
// rerun that workflow and update this map and those nodes.
const GMAIL_LABELS = {
  'Launchbench': 'Label_1',
  'Launchbench/Error': 'Label_2',
  'Launchbench/Lead': 'Label_3',
  'Launchbench/Lead/Hot': 'Label_4',
  'Launchbench/Lead/Warm': 'Label_5',
  'Launchbench/Lead/Cold': 'Label_6',
  'Launchbench/Issue': 'Label_7',
  'Launchbench/Issue/P1': 'Label_8',
  'Launchbench/Issue/P2': 'Label_9',
  'Launchbench/Issue/P3': 'Label_10',
  'Launchbench/Issue/P4': 'Label_11',
  'Launchbench/Billing': 'Label_12',
  'Launchbench/Vendor': 'Label_13',
  'Launchbench/Vendor/Pass': 'Label_14',
  'Launchbench/Vendor/Hold': 'Label_15',
  'Launchbench/Vendor/Flag': 'Label_16',
  'Launchbench/Vendor/Fraud': 'Label_17',
  'Launchbench/Change': 'Label_18',
  'Launchbench/Query': 'Label_19',
  'Launchbench/Noise': 'Label_20',
  'Launchbench/Awaiting approval': 'Label_21',
  'Launchbench/Demo': 'Label_22',
  'Launchbench/Demo/Assigned member': 'Label_23',
};
// Where each is applied:
//   WF-0 "Label the email": one class label per intent (Lead, Issue, Billing, Vendor,
//        Change, Query, Noise) + Demo/Assigned member; live email only.
//   WF-1 Lead/Hot|Warm|Cold, WF-2 Issue/P1-P4, WF-4 Vendor/Pass|Hold|Flag|Fraud.
//   WF-1, WF-3, WF-5: Awaiting approval while an approval card is open.
//   WF-E: Error on unanswered emails.
if (typeof module !== 'undefined') module.exports = GMAIL_LABELS;
