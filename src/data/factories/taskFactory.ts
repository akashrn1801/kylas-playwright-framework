import { faker } from '@faker-js/faker';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const TASK_TYPE_OPTIONS = ['Call', 'Follow Up', 'Reminder', 'Todo'] as const;
export type TaskType = (typeof TASK_TYPE_OPTIONS)[number];

export const TASK_STATUS_OPTIONS = ['Open', 'In Progress', 'Completed', 'Cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUS_OPTIONS)[number];

export const TASK_PRIORITY_OPTIONS = ['High', 'Medium', 'Low'] as const;
export type TaskPriority = (typeof TASK_PRIORITY_OPTIONS)[number];

export const TASK_REMINDER_OPTIONS = [
  'No reminder',
  '15 minutes before the due date and time',
  '30 minutes before the due date and time',
  '1 hour before the due date and time',
  '2 hours before the due date and time',
  '1 day before the due date and time',
] as const;
export type TaskReminder = (typeof TASK_REMINDER_OPTIONS)[number];

// ─── Interface ────────────────────────────────────────────────────────────────

export interface TaskData {
  name: string;
  type: TaskType;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  reminder: TaskReminder;
}

// ─── Factories ────────────────────────────────────────────────────────────────

export function generateTaskData(overrides: Partial<TaskData> = {}): TaskData {
  return {
    name: `${faker.company.buzzVerb()} ${faker.company.buzzNoun()} Task`,
    type: faker.helpers.arrayElement(TASK_TYPE_OPTIONS),
    description: faker.lorem.sentence(),
    status: 'Open',
    priority: faker.helpers.arrayElement(TASK_PRIORITY_OPTIONS),
    reminder: '1 hour before the due date and time',
    ...overrides,
  };
}

// WHY: Admin task data uses a unique timestamp prefix to avoid collision
// with old test data in staging/qa databases from previous test runs.
// Restricted user searching for "ADM1234567890 Task" will NEVER find
// a task from a previous test run — guaranteed uniqueness.
export function generateAdminTaskData(overrides: Partial<TaskData> = {}): TaskData {
  const timestamp = Date.now().toString();
  return {
    name: `ADM${timestamp} Task`,
    type: faker.helpers.arrayElement(TASK_TYPE_OPTIONS),
    description: `Admin task created at ${timestamp}. RBAC isolation test.`,
    status: 'Open',
    priority: faker.helpers.arrayElement(TASK_PRIORITY_OPTIONS),
    reminder: '1 hour before the due date and time',
    ...overrides,
  };
}