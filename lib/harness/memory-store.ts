import type { HarnessEvent } from './types';
import type { SimulationRecord, SkillProposal, TaskRecordRow, TaskStore } from './store';

/**
 * 用于单元测试与本地降级的纯内存任务存储：行为与 D1 实现保持一致。
 */
export function createMemoryStore(seed: { prompt?: string; id?: string } = {}): TaskStore & {
  snapshot: () => { events: HarnessEvent[]; task: TaskRecordRow; simulations: SimulationRecord[]; skills: SkillProposal[] };
} {
  const events: HarnessEvent[] = [];
  const simulations: SimulationRecord[] = [];
  const skills: SkillProposal[] = [];
  const task: TaskRecordRow = {
    id: seed.id ?? 'task-memory',
    prompt: seed.prompt ?? '',
    status: 'queued',
    mode: 'rule',
    attempt: 0,
  };
  return {
    async createTask() {},
    async getTask(id) {
      return id === task.id ? { ...task } : null;
    },
    async updateTask(_id, patch) {
      Object.assign(task, patch);
    },
    async appendEvent(event) {
      events.push({ seq: event.seq, type: event.type, at: event.at, payload: event.payload });
    },
    async getEvents(_taskId, afterSeq) {
      return events.filter((event) => event.seq > afterSeq);
    },
    async saveSimulation(record) {
      simulations.push(record);
    },
    async saveStepStates() {},
    async saveFindings() {},
    async proposeSkill(proposal) {
      skills.push({ ...proposal, status: proposal.status ?? 'candidate', createdAt: Date.now() });
    },
    async listApprovedSkills() {
      return skills.filter((skill) => skill.status === 'approved');
    },
    async nextSkillVersion(name) {
      const versions = skills.filter((skill) => skill.name === name).map((skill) => skill.version);
      return (versions.length ? Math.max(...versions) : 0) + 1;
    },
    snapshot() {
      return { events: [...events], task: { ...task }, simulations: [...simulations], skills: [...skills] };
    },
  };
}
