import { translateHeartbeat } from '../src/translator';
import type { HeartbeatPayload } from '../src/contracts';

const payload: HeartbeatPayload = {
  agent_id: 'agent-1',
  company_id: 'acme',
  task: {
    id: 'T-123',
    title: 'Implement feature',
    description: 'Build the adapter endpoint.',
    goal_context: {
      company_mission: 'Ship reliable AI tooling.',
      project_goal: 'Launch the adapter.',
      agent_goal: 'Implement the server.'
    }
  },
  budget_remaining: 12.5,
  callback_url: 'https://paperclip.example/callback',
  metadata: {
    priority: 'high'
  }
};

describe('translateHeartbeat', () => {
  it('constructs the A0 message string with the activation directive', () => {
    const message = translateHeartbeat(payload, {
      DEFAULT_COMPANY_MISSION: 'default company',
      DEFAULT_PROJECT_GOAL: 'default project',
      DEFAULT_AGENT_GOAL: 'default agent'
    });

    expect(message).toContain('[ACTIVATE_PROJECT: acme]');
    expect(message).toContain('**Ticket:** #T-123 | Budget Remaining: $12.50');
    expect(message).toContain('Do not ask clarifying questions');
  });

  it('falls back to defaults when goal context fields are missing', () => {
    const message = translateHeartbeat(
      {
        ...payload,
        task: {
          ...payload.task,
          goal_context: {}
        }
      },
      {
        DEFAULT_COMPANY_MISSION: 'default company',
        DEFAULT_PROJECT_GOAL: 'default project',
        DEFAULT_AGENT_GOAL: 'default agent'
      }
    );

    expect(message).toContain('**Company Mission:** default company');
    expect(message).toContain('**Project Goal:** default project');
    expect(message).toContain('**Your Goal:** default agent');
    expect(message).not.toContain('undefined');
  });
});
