import type { GoalContext, HeartbeatPayload } from './contracts';

export interface TranslationDefaults {
  DEFAULT_COMPANY_MISSION: string;
  DEFAULT_PROJECT_GOAL: string;
  DEFAULT_AGENT_GOAL: string;
}

function resolveGoalContext(goalContext: GoalContext | undefined, defaults: TranslationDefaults): Required<GoalContext> {
  return {
    company_mission: goalContext?.company_mission?.trim() || defaults.DEFAULT_COMPANY_MISSION,
    project_goal: goalContext?.project_goal?.trim() || defaults.DEFAULT_PROJECT_GOAL,
    agent_goal: goalContext?.agent_goal?.trim() || defaults.DEFAULT_AGENT_GOAL
  };
}

export function translateHeartbeat(payload: HeartbeatPayload, defaults: TranslationDefaults): string {
  const goalContext = resolveGoalContext(payload.task.goal_context, defaults);
  const budgetText = payload.budget_remaining.toFixed(2);

  return [
    `[ACTIVATE_PROJECT: ${payload.company_id}]`,
    '',
    '## PAPERCLIP CONTEXT',
    `**Company Mission:** ${goalContext.company_mission}`,
    `**Project Goal:** ${goalContext.project_goal}`,
    `**Your Goal:** ${goalContext.agent_goal}`,
    `**Ticket:** #${payload.task.id} | Budget Remaining: $${budgetText}`,
    '',
    '## TASK',
    payload.task.title,
    '',
    payload.task.description,
    '',
    '---',
    'When this task is complete, output a concise summary of what was done.',
    'Do not ask clarifying questions — work with the information provided.'
  ].join('\n');
}
