import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  prompt: text('prompt').notNull(),
  status: text('status').notNull(),
  resultJson: text('result_json'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const simulationRuns = sqliteTable('simulation_runs', {
  id: text('id').primaryKey(),
  taskId: text('task_id').references(() => tasks.id),
  seed: integer('seed').notNull(),
  customerCount: integer('customer_count').notNull(),
  timeSteps: integer('time_steps').notNull(),
  scenarioJson: text('scenario_json').notNull(),
  recommendedStrategy: text('recommended_strategy').notNull(),
  summaryJson: text('summary_json').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  taskId: text('task_id').references(() => tasks.id),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  result: text('result').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});
