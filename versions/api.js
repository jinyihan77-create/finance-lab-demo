'use strict';
(()=>{
function sha256(input) {
  const data=new TextEncoder().encode(input),length=Math.ceil((data.length+9)/64)*64;
  const bytes=new Uint8Array(length);bytes.set(data);bytes[data.length]=128;
  const view=new DataView(bytes.buffer),bits=data.length*8;
  view.setUint32(length-8,Math.floor(bits/4294967296));view.setUint32(length-4,bits>>>0);
  const initial=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const constants=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const rotate=(n,b)=>(n>>>b)|(n<<(32-b)),words=new Uint32Array(64);
  for(let offset=0;offset<length;offset+=64){
    for(let i=0;i<16;i++)words[i]=view.getUint32(offset+i*4);
    for(let i=16;i<64;i++){const x=words[i-15],y=words[i-2];words[i]=(words[i-16]+(rotate(x,7)^rotate(x,18)^(x>>>3))+words[i-7]+(rotate(y,17)^rotate(y,19)^(y>>>10)))>>>0;}
    let [a,b,c,d,e,f,g,h]=initial;
    for(let i=0;i<64;i++){const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^((~e)&g))+constants[i]+words[i])>>>0;const t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
    [a,b,c,d,e,f,g,h].forEach((n,i)=>{initial[i]=(initial[i]+n)>>>0;});
  }
  return initial.map(n=>n.toString(16).padStart(8,'0')).join('');
}
const factories={"core/harness.js":function(module,exports,require){
"use strict";

const crypto = require("node:crypto");
const { MemoryStore } = require("./memory");
const financialTools = require("../tools/financial-tools");

const REQUIRED_RISK_FIELDS = ["investment_horizon_days", "max_drawdown", "liquidity_need"];
const OWNED_STAGES = ["VALIDATE_INPUT", "DIAGNOSE", "GENERATE_CANDIDATES", "SIMULATE"];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function missingRiskFields(riskProfile) {
  return REQUIRED_RISK_FIELDS.filter((field) => riskProfile === null || riskProfile === undefined || riskProfile[field] === undefined || riskProfile[field] === null || riskProfile[field] === "");
}

class Harness {
  constructor({ toolset = financialTools, memory = new MemoryStore() } = {}) {
    this.toolset = toolset;
    this.memory = memory;
    this.tasks = new Map();
  }

  createSession({ intent = "PORTFOLIO_HEALTH_CHECK", risk_profile: riskProfile = null } = {}) {
    this.validateProfile(riskProfile);
    const sessionId = id("session");
    const taskId = id("task");
    const missingFields = missingRiskFields(riskProfile);
    const state = {
      task_id: taskId,
      session_id: sessionId,
      intent,
      stage: missingFields.length ? "MINIMUM_CLARIFICATION" : "VALIDATE_INPUT",
      status: missingFields.length ? "WAITING_INPUT" : "READY",
      risk_profile: clone(riskProfile),
      missing_fields: missingFields,
      portfolio_snapshot_id: null,
      risk_profile_id: riskProfile ? `risk-profile-${crypto.randomUUID()}` : null,
      tool_result_refs: [],
      proposed_action_ids: [],
      risk_decision_id: null,
      approval_id: null,
      error_state: null,
      checkpoint: {
        stage: missingFields.length ? "MINIMUM_CLARIFICATION" : "VALIDATE_INPUT",
        completed: [],
        result_refs: {},
        resume_token: id("resume")
      }
    };
    const task = { state, artifacts: {}, events: [], failures: {}, results: {} };
    this.tasks.set(taskId, task);
    this.addEvent(task, "session.created", { missing_fields: missingFields });
    return this.getTask(taskId);
  }

  getTask(taskId) {
    const task = this.tasks.get(taskId);
    return task ? clone({ task_state: task.state, artifacts: task.artifacts, tool_results: task.results }) : null;
  }

  validateProfile(profile) {
    if (profile == null) return;
    if (typeof profile !== "object" || Array.isArray(profile)) throw new Error("risk_profile must be an object");
    if (profile.max_drawdown !== undefined && (!Number.isFinite(profile.max_drawdown) || profile.max_drawdown <= 0 || profile.max_drawdown > 1))
      throw new Error("max_drawdown must be between 0 and 1");
    if (profile.investment_horizon_days !== undefined && (!Number.isInteger(profile.investment_horizon_days) || profile.investment_horizon_days <= 0))
      throw new Error("investment_horizon_days must be a positive integer");
    if (profile.liquidity_need !== undefined && !["low", "medium", "high"].includes(profile.liquidity_need))
      throw new Error("liquidity_need must be low, medium or high");
  }

  getAudit(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    return clone({ task_id: taskId, task_state: task.state, events: task.events });
  }

  addEvent(task, eventType, payload = {}) {
    task.events.push({
      event_id: id("event"),
      task_id: task.state.task_id,
      actor: "harness",
      event_type: eventType,
      payload: clone(payload),
      timestamp: new Date().toISOString()
    });
  }

  checkpoint(task, stage, resultRef = null) {
    if (!task.state.checkpoint.completed.includes(stage)) task.state.checkpoint.completed.push(stage);
    task.state.checkpoint.stage = stage;
    task.state.checkpoint.last_tool_result_ref = resultRef;
    task.state.checkpoint.result_refs[stage] = resultRef;
  }

  runOrReuse(task, stage, artifactKey, outputFactory, operation) {
    if (task.state.checkpoint.completed.includes(stage) && task.artifacts[artifactKey]) {
      const result = {
        tool_name: `checkpoint.${stage.toLowerCase()}`,
        version: "checkpoint@1.0.0",
        inputs_hash: task.state.checkpoint.result_refs[stage] || "checkpoint",
        output: outputFactory(task),
        data_as_of: this.toolset.constants ? this.toolset.constants.DATA_AS_OF : null,
        warnings: ["result reused from checkpoint"],
        trace_id: task.state.checkpoint.result_refs[stage]
      };
      this.addEvent(task, "stage.reused", { stage, result_ref: result.trace_id });
      return result;
    }
    return this.runNode(task, stage, operation);
  }

  runNode(task, stage, operation) {
    if (!OWNED_STAGES.includes(stage)) throw new Error(`stage is outside Harness ownership: ${stage}`);
    task.state.stage = stage;
    task.state.status = "RUNNING";
    this.addEvent(task, "stage.started", { stage });
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = operation();
        const resultRef = result.trace_id || `tool-result-${crypto.randomUUID()}`;
        task.results[resultRef] = clone(result);
        task.state.tool_result_refs.push(resultRef);
        delete task.failures[stage];
        this.checkpoint(task, stage, resultRef);
        this.addEvent(task, "stage.completed", { stage, attempt, result_ref: resultRef });
        return result;
      } catch (error) {
        lastError = error;
        task.failures[stage] = (task.failures[stage] || 0) + 1;
        this.addEvent(task, "stage.failed", { stage, attempt, code: error.code || "TOOL_ERROR", message: error.message });
        if (attempt === 1) this.addEvent(task, "stage.retry_scheduled", { stage, reason: error.message });
      }
    }
    task.state.status = Object.values(task.failures).some((count) => count >= 3) ? "CIRCUIT_OPEN" : "FAILED";
    task.state.error_state = {
      code: lastError.code || "TOOL_ERROR",
      message: lastError.message,
      stage,
      retryable: false,
      recovery: "Fix the input or data source and resume from the latest checkpoint."
    };
    this.addEvent(task, "task.failed", task.state.error_state);
    throw lastError;
  }

  runHealthCheck({ task_id: taskId, session_id: sessionId, risk_profile: riskProfile, portfolio } = {}) {
    this.validateProfile(riskProfile);
    let task = taskId ? this.tasks.get(taskId) : null;
    if (taskId && !task) throw Object.assign(new Error("task not found"), { statusCode: 404 });
    if (!task) {
      const created = this.createSession({ risk_profile: riskProfile });
      task = this.tasks.get(created.task_state.task_id);
    }
    if (sessionId && task.state.session_id !== sessionId) throw new Error("session_id does not match task");
    if (task.state.status === "CIRCUIT_OPEN") throw new Error("circuit is open; create a new task after repairing the tool");
    const changed = (portfolio !== undefined && JSON.stringify(portfolio) !== JSON.stringify(task.inputPortfolio)) ||
      (riskProfile !== undefined && JSON.stringify(riskProfile) !== JSON.stringify(task.state.risk_profile));
    if (changed) {
      task.artifacts = {}; task.results = {}; task.state.tool_result_refs = []; task.state.proposed_action_ids = [];
      task.state.portfolio_snapshot_id = null; task.state.handoff = null;
      task.state.checkpoint.completed = []; task.state.checkpoint.result_refs = {};
      task.state.status = "READY"; task.state.error_state = null; task.failures = {};
      this.addEvent(task, "checkpoint.invalidated", { reason: "input changed" });
    }
    if (portfolio !== undefined) task.inputPortfolio = clone(portfolio);
    if (task.state.status === "HANDOFF_REQUIRED") return this.getTask(task.state.task_id);
    if (riskProfile !== undefined) {
      task.state.risk_profile = clone(riskProfile);
      task.state.risk_profile_id = riskProfile ? id("risk-profile") : null;
      task.state.missing_fields = missingRiskFields(riskProfile);
    }
    if (task.state.missing_fields.length) {
      task.state.stage = "MINIMUM_CLARIFICATION";
      task.state.status = "WAITING_INPUT";
      this.addEvent(task, "clarification.required", { missing_fields: task.state.missing_fields });
      return this.getTask(task.state.task_id);
    }

    const validation = this.runOrReuse(
      task,
      "VALIDATE_INPUT",
      "portfolio_snapshot",
      (currentTask) => ({ valid: true, snapshot: currentTask.artifacts.portfolio_snapshot }),
      () => this.toolset.validatePortfolio(task.inputPortfolio || this.toolset.getDemoPortfolio())
    );
    if (!validation.output.valid) {
      task.state.status = "BLOCKED";
      task.state.error_state = { code: "INVALID_PORTFOLIO", reasons: validation.output.errors, recovery: "Correct the portfolio snapshot and run validation again." };
      this.addEvent(task, "task.blocked", task.state.error_state);
      return this.getTask(task.state.task_id);
    }
    const snapshot = validation.output.snapshot;
    task.state.portfolio_snapshot_id = snapshot.snapshot_id;
    task.artifacts.portfolio_snapshot = snapshot;

    const diagnosis = this.runOrReuse(
      task,
      "DIAGNOSE",
      "health_report",
      (currentTask) => currentTask.artifacts.health_report,
      () => this.toolset.diagnosePortfolio(snapshot)
    );
    task.artifacts.health_report = diagnosis.output;

    const candidates = this.runOrReuse(
      task,
      "GENERATE_CANDIDATES",
      "candidates",
      (currentTask) => ({ snapshot_id: snapshot.snapshot_id, report_id: currentTask.artifacts.health_report.report_id, candidates: currentTask.artifacts.candidates }),
      () => this.toolset.generateCandidates(snapshot, diagnosis.output)
    );
    task.state.proposed_action_ids = candidates.output.candidates.map((candidate) => candidate.proposal_id);
    task.artifacts.candidates = candidates.output.candidates;

    const simulation = this.runOrReuse(
      task,
      "SIMULATE",
      "simulation",
      (currentTask) => currentTask.artifacts.simulation,
      () => this.toolset.runSimulation(snapshot, candidates.output.candidates)
    );
    task.artifacts.simulation = simulation.output;
    task.state.stage = "RISK_CHECK";
    task.state.status = "HANDOFF_REQUIRED";
    task.state.checkpoint.stage = "RISK_CHECK";
    task.state.handoff = { owner: "Safety/Risk/Eval", reason: "Risk decision is outside Agent Core and Tools ownership." };
    this.addEvent(task, "stage.handoff", task.state.handoff);
    return this.getTask(task.state.task_id);
  }

  resume(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    if (["FAILED", "BLOCKED"].includes(task.state.status)) {
      task.state.status = "READY";
      task.state.error_state = null;
      this.addEvent(task, "task.resumed", { checkpoint: task.state.checkpoint });
    }
    return this.getTask(taskId);
  }

  saveMemory(taskId, record) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("task not found");
    const entry = this.memory.save(task.state.session_id, record);
    this.addEvent(task, "memory.saved", { memory_id: entry.memory_id, type: entry.type });
    return entry;
  }

  listMemory(sessionId) {
    return this.memory.list(sessionId);
  }

  reset() {
    this.tasks.clear();
    this.memory.reset();
  }
}

module.exports = { Harness, REQUIRED_RISK_FIELDS };

},
"core/memory.js":function(module,exports,require){
"use strict";

const crypto = require("node:crypto");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MemoryStore {
  constructor() {
    this.sessions = new Map();
  }

  ensureSession(sessionId) {
    if (!sessionId) throw new Error("session_id is required");
    if (!this.sessions.has(sessionId)) this.sessions.set(sessionId, []);
    return this.sessions.get(sessionId);
  }

  save(sessionId, record) {
    if (!record || !["preference", "decision"].includes(record.type)) {
      throw new Error("memory type must be preference or decision");
    }
    if (record.consent !== true) throw new Error("explicit consent is required before memory is saved");
    const entries = this.ensureSession(sessionId);
    const entry = {
      memory_id: `memory-${crypto.randomUUID()}`,
      session_id: sessionId,
      type: record.type,
      key: record.key || record.type,
      value: clone(record.value || {}),
      source: "user_confirmed",
      created_at: new Date().toISOString()
    };
    entries.push(entry);
    return clone(entry);
  }

  list(sessionId) {
    return clone(this.sessions.get(sessionId) || []);
  }

  clear(sessionId) {
    this.sessions.delete(sessionId);
    return { session_id: sessionId, cleared: true };
  }

  reset() {
    this.sessions.clear();
  }
}

module.exports = { MemoryStore };

},
"tools/financial-tools.js":function(module,exports,require){
"use strict";

const crypto = require("node:crypto");
const dataset = require("../data/demo-portfolio.json");

const TOOL_VERSION = "financial-tools@0.4.0";
const PERIODS_PER_YEAR = 252;
const DEFAULT_SCENARIO_PATHS = 2000;
const DEFAULT_SCENARIO_SEED = dataset.scenario_seed;
const paperReceipts = new Map();

class FinancialToolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FinancialToolError";
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function round(value, digits = 8) {
  const factor = 10 ** digits;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values) {
  return values.length ? sum(values) / values.length : 0;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(sum(values.map((value) => (value - average) ** 2)) / (values.length - 1));
}

function correlation(left, right) {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftMean = mean(left);
  const rightMean = mean(right);
  const numerator = sum(left.map((value, index) => (value - leftMean) * (right[index] - rightMean)));
  const leftDenominator = Math.sqrt(sum(left.map((value) => (value - leftMean) ** 2)));
  const rightDenominator = Math.sqrt(sum(right.map((value) => (value - rightMean) ** 2)));
  if (!leftDenominator || !rightDenominator) return 0;
  return round(numerator / (leftDenominator * rightDenominator), 6);
}

function quantile(values, probability) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return round(sorted[lower]);
  return round(sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower));
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function makeToolResult(toolName, inputs, output, warnings = []) {
  return {
    tool_name: toolName,
    version: TOOL_VERSION,
    inputs_hash: hash(inputs),
    output,
    data_as_of: dataset.as_of,
    warnings: [...warnings, "Synthetic replay data: seven observations only; not suitable for investment decisions."],
    trace_id: `trace-${hash({ toolName, inputs }).slice(0, 16)}`
  };
}

function getDemoPortfolio() {
  return clone(dataset.portfolio);
}

function latestPrice(instrumentId) {
  const prices = dataset.price_history.prices[instrumentId];
  return prices ? prices[prices.length - 1] : null;
}

function validatePortfolio(input = getDemoPortfolio()) {
  const candidate = input && input.portfolio ? input.portfolio : input;
  const positions = Array.isArray(candidate && candidate.positions) ? candidate.positions : [];
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const normalizedPositions = [];

  if (!candidate || typeof candidate !== "object") errors.push("portfolio must be an object");
  const cash = candidate && candidate.cash;
  if (!Number.isFinite(cash) || cash < 0) errors.push("cash must be a non-negative number");
  if (!positions.length) errors.push("positions must contain at least one instrument");

  for (const position of positions) {
    const instrumentId = position && position.instrument_id;
    const metadata = dataset.instrument_metadata[instrumentId];
    const quantity = position && position.quantity;
    const price = position && position.price === undefined ? latestPrice(instrumentId) : position && position.price;
    if (!instrumentId || seen.has(instrumentId)) errors.push(`duplicate or missing instrument_id: ${instrumentId || "unknown"}`);
    if (instrumentId) seen.add(instrumentId);
    if (!metadata) errors.push(`unsupported instrument: ${instrumentId || "unknown"}`);
    if (!Number.isFinite(quantity) || quantity <= 0) errors.push(`quantity must be positive: ${instrumentId || "unknown"}`);
    if (!Number.isFinite(price) || price <= 0) errors.push(`price must be positive: ${instrumentId || "unknown"}`);
    if (metadata && position.type && position.type !== metadata.type) errors.push(`instrument type mismatch: ${instrumentId}`);
    if (metadata && Number.isFinite(quantity) && quantity % metadata.lot_size !== 0) {
      errors.push(`quantity must respect lot_size for ${instrumentId}`);
    }
    if (metadata && Number.isFinite(quantity) && Number.isFinite(price)) {
      normalizedPositions.push({
        instrument_id: instrumentId,
        name: position.name || instrumentId,
        type: metadata.type,
        sector: position.sector || "Unclassified",
        quantity,
        price: round(price, 4),
        market_value: round(quantity * price, 4)
      });
    }
  }

  const totalValue = cash + sum(normalizedPositions.map((position) => position.market_value));
  if (!Number.isFinite(totalValue) || totalValue <= 0) errors.push("total_value must be positive");
  if (candidate && candidate.total_value !== undefined && (!Number.isFinite(candidate.total_value) || Math.abs(candidate.total_value - totalValue) > 0.01)) {
    errors.push("declared total_value does not equal cash plus market value");
  }
  if (!candidate || candidate.as_of !== dataset.as_of) errors.push("snapshot date must match the fixed replay data_as_of");
  for (const position of normalizedPositions) {
    if (Math.abs(position.price - latestPrice(position.instrument_id)) > 0.0001) errors.push("price does not match fixed replay data: " + position.instrument_id);
  }

  const snapshot = {
    snapshot_id: `snapshot-${hash({ candidate, totalValue }).slice(0, 16)}`,
    portfolio_id: candidate && candidate.portfolio_id ? candidate.portfolio_id : "imported-portfolio",
    as_of: candidate && candidate.as_of ? candidate.as_of : dataset.as_of,
    positions: normalizedPositions.map((position) => ({
      ...position,
      weight: totalValue ? round(position.market_value / totalValue, 8) : 0
    })),
    cash: round(cash, 4),
    cash_weight: totalValue ? round(cash / totalValue, 8) : 0,
    total_value: round(totalValue, 4),
    data_quality: {
      status: errors.length ? "INVALID" : "VALID",
      errors,
      warnings
    }
  };

  return makeToolResult("portfolio.import", input, {
    valid: errors.length === 0,
    snapshot: errors.length ? null : snapshot,
    errors,
    warnings
  }, warnings);
}

function requireSnapshot(snapshotOrInput) {
  const result = validatePortfolio(snapshotOrInput || getDemoPortfolio());
  if (!result.output.valid) throw new FinancialToolError("INVALID_PORTFOLIO", "portfolio validation failed", result.output);
  if (snapshotOrInput && snapshotOrInput.snapshot_id) {
    const normalized = result.output.snapshot;
    for (const p of snapshotOrInput.positions) {
      const n = normalized.positions.find(v => v.instrument_id === p.instrument_id);
      if (!Number.isFinite(p.weight) || !Number.isFinite(p.market_value) || Math.abs(n.weight - p.weight) > 1e-6 || Math.abs(n.market_value - p.market_value) > 0.01)
        throw new FinancialToolError("INVALID_PORTFOLIO", "snapshot amounts and weights are inconsistent");
    }
    if (!Number.isFinite(snapshotOrInput.cash_weight) || Math.abs(normalized.cash_weight - snapshotOrInput.cash_weight) > 1e-6)
      throw new FinancialToolError("INVALID_PORTFOLIO", "cash weight is inconsistent");
    return { ...normalized, snapshot_id: snapshotOrInput.snapshot_id };
  }
  return result.output.snapshot;
}

function getPriceSeries(instrumentId) {
  const series = dataset.price_history.prices[instrumentId];
  if (!series || series.length !== dataset.price_history.dates.length) {
    throw new FinancialToolError("MISSING_MARKET_DATA", `price history unavailable: ${instrumentId}`);
  }
  return series;
}

function weightsFor(snapshot) {
  const weights = snapshot.positions.reduce((weights, position) => {
    weights[position.instrument_id] = position.weight;
    return weights;
  }, { CASH: snapshot.cash_weight });
  weights.CASH = round(1 - sum(snapshot.positions.map(position => position.weight)));
  return weights;
}

function buildPath(snapshot, weights) {
  return dataset.price_history.dates.map((date, index) => {
    const securityValue = sum(Object.keys(weights).filter(id => id !== "CASH").map((id) => {
      const prices = getPriceSeries(id);
      return (weights[id] || 0) * prices[index] / prices[0];
    }));
    return { date, value: round((weights.CASH || 0) + securityValue, 8) };
  });
}

function metricsFromPath(path, transactionCost = 0) {
  const values = path.map((point) => point.value);
  const returns = values.slice(1).map((value, index) => value / values[index] - 1);
  let peak = values[0] || 1;
  let maxDrawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
  }
  const volatility = standardDeviation(returns) * Math.sqrt(PERIODS_PER_YEAR);
  const annualizedReturn = returns.length ? (values[values.length - 1] ** (PERIODS_PER_YEAR / returns.length)) - 1 : 0;
  const riskFreeRate = 0.02;
  const sharpe = volatility ? (mean(returns) * PERIODS_PER_YEAR - riskFreeRate) / volatility : 0;
  return {
    cumulative_return: round(values[values.length - 1] - 1 - transactionCost),
    annualized_return: round(annualizedReturn),
    annualized_volatility: round(volatility),
    max_drawdown: round(maxDrawdown),
    sharpe_ratio: round(sharpe),
    ending_index: round(values[values.length - 1] - transactionCost)
  };
}

function diagnosePortfolio(snapshotOrInput) {
  const snapshot = requireSnapshot(snapshotOrInput);
  const weights = weightsFor(snapshot);
  const assetReturns = {};
  for (const position of snapshot.positions) {
    const prices = getPriceSeries(position.instrument_id);
    assetReturns[position.instrument_id] = prices.slice(1).map((price, index) => price / prices[index] - 1);
  }
  const path = buildPath(snapshot, weights);
  const metrics = metricsFromPath(path);
  const correlations = {};
  const hiddenClusters = [];
  const ids = snapshot.positions.map((position) => position.instrument_id);
  for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
    correlations[ids[leftIndex]] = {};
    for (let rightIndex = 0; rightIndex < ids.length; rightIndex += 1) {
      correlations[ids[leftIndex]][ids[rightIndex]] = leftIndex === rightIndex
        ? 1
        : correlation(assetReturns[ids[leftIndex]], assetReturns[ids[rightIndex]]);
      if (rightIndex > leftIndex && correlations[ids[leftIndex]][ids[rightIndex]] >= 0.8) {
        hiddenClusters.push({
          instruments: [ids[leftIndex], ids[rightIndex]],
          correlation: correlations[ids[leftIndex]][ids[rightIndex]]
        });
      }
    }
  }
  const orderedWeights = Object.entries(weights).filter(([id]) => id !== "CASH").sort((left, right) => right[1] - left[1]);
  const hhi = sum(Object.values(weights).map((weight) => weight ** 2));
  const report = {
    report_id: `health-${hash({ snapshot: snapshot.snapshot_id, weights }).slice(0, 16)}`,
    snapshot_id: snapshot.snapshot_id,
    metrics,
    cash_weight: snapshot.cash_weight,
    concentration: {
      hhi: round(hhi),
      hhi_basis: "all assets including cash; top-N excludes cash",
      top_1: round(orderedWeights[0][1]),
      top_3: round(sum(orderedWeights.slice(0, 3).map((entry) => entry[1]))),
      largest_instrument: orderedWeights[0][0]
    },
    correlation_matrix: correlations,
    hidden_clusters: hiddenClusters,
    attention_points: [
      ...(orderedWeights[0][1] > 0.2 ? ["largest position exceeds 20%"] : []),
      ...(hiddenClusters.length ? ["multiple instruments move together in the fixed window"] : []),
      ...(snapshot.cash_weight < 0.1 ? ["cash buffer is below 10%"] : [])
    ],
    data_window: {
      start: dataset.price_history.dates[0],
      end: dataset.price_history.dates[dataset.price_history.dates.length - 1],
      observations: dataset.price_history.dates.length,
      annualization_factor: PERIODS_PER_YEAR
    }
  };
  return makeToolResult("portfolio.diagnose", snapshot, report);
}

function normalizeWeights(weights) {
  const total = sum(Object.values(weights));
  if (!total) throw new FinancialToolError("INVALID_WEIGHTS", "target weights must sum to a positive value");
  const normalized = Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, round(value / total, 8)]));
  const remainder = round(1 - sum(Object.values(normalized)), 8);
  normalized.CASH = round((normalized.CASH || 0) + remainder, 8);
  return normalized;
}

function capSecurityWeights(weights, maxSingleAssetWeight) {
  const capped = { ...weights };
  let released = 0;
  for (const [instrumentId, weight] of Object.entries(capped)) {
    if (instrumentId !== "CASH" && weight > maxSingleAssetWeight) {
      released += weight - maxSingleAssetWeight;
      capped[instrumentId] = maxSingleAssetWeight;
    }
  }
  capped.CASH = (capped.CASH || 0) + released;
  return normalizeWeights(capped);
}

function turnoverBetween(current, target) {
  const ids = new Set([...Object.keys(current), ...Object.keys(target)]);
  return round(sum([...ids].map((id) => Math.abs((target[id] || 0) - (current[id] || 0)))) / 2);
}

function validateProposal(proposal, { requireHash = false } = {}) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) return { valid: false, errors: ["proposal must be an object"] };
  const errors = [];
  const targetWeights = proposal && proposal.target_weights;
  const constraints = proposal && proposal.constraints;
  if (!proposal || typeof proposal !== "object") errors.push("proposal must be an object");
  if (!targetWeights || typeof targetWeights !== "object") errors.push("target_weights must be an object");
  if (!constraints || typeof constraints !== "object") errors.push("constraints must be an object");

  if (targetWeights && typeof targetWeights === "object") {
    const values = Object.values(targetWeights);
    if (!values.length) errors.push("target_weights must contain at least one asset");
    if (Array.isArray(targetWeights) || values.some((value) => !Number.isFinite(value) || value < 0)) errors.push("target_weights must contain finite non-negative numbers");
    if (Object.keys(targetWeights).some(id => id !== "CASH" && !Object.hasOwn(dataset.instrument_metadata, id))) errors.push("unknown instrument in target_weights");
    const weightSum = sum(values.map(Number));
    if (Math.abs(weightSum - 1) > 0.000001) errors.push(`target_weights must sum to 1, received ${round(weightSum)}`);
    const securityWeights = Object.entries(targetWeights).filter(([instrumentId]) => instrumentId !== "CASH").map(([, value]) => Number(value));
    if (constraints && Number.isFinite(Number(constraints.max_single_asset_weight)) && securityWeights.some((weight) => weight > Number(constraints.max_single_asset_weight) + 0.000001)) {
      errors.push("target_weights exceed max_single_asset_weight");
    }
  }
  if (!constraints || !Number.isFinite(constraints.max_turnover) || constraints.max_turnover < 0 || constraints.max_turnover > 1 ||
      !Number.isFinite(constraints.max_single_asset_weight) || constraints.max_single_asset_weight <= 0 || constraints.max_single_asset_weight > 1)
    errors.push("invalid numeric constraints");

  if (!Number.isFinite(proposal.turnover) || proposal.turnover < 0) errors.push("turnover must be a non-negative number");
  if (constraints && Number.isFinite(Number(constraints.max_turnover)) && Number(proposal.turnover) > Number(constraints.max_turnover) + 0.000001) {
    errors.push("turnover exceeds max_turnover");
  }

  if (!Array.isArray(proposal.actions) || !proposal.actions.length) errors.push("actions must be a non-empty array");
  if (Array.isArray(proposal.actions) && targetWeights) {
    const seen = new Set();
    for (const action of proposal.actions) {
      if (!action || typeof action.instrument_id !== "string" || seen.has(action.instrument_id) ||
          !Number.isFinite(action.from_weight) || !Number.isFinite(action.to_weight) || !Number.isFinite(action.delta_weight)) {
        errors.push("invalid or duplicate action"); continue;
      }
      seen.add(action.instrument_id);
      const target = Number(targetWeights[action.instrument_id] || 0);
      if (Math.abs(target - Number(action.to_weight)) > 0.000001) errors.push(`action target mismatch: ${action.instrument_id}`);
      if (Math.abs(action.to_weight - action.from_weight - action.delta_weight) > 0.000001) errors.push("action delta mismatch");
    }
    if (Object.keys(targetWeights).some(id => !seen.has(id))) errors.push("missing action for target asset");
  }

  if (requireHash || proposal && proposal.proposal_hash) {
    const unsigned = clone(proposal || {});
    delete unsigned.proposal_hash;
    delete unsigned.validation;
    if (!proposal.proposal_hash || proposal.proposal_hash !== hash(unsigned)) errors.push("proposal_hash does not match proposal contents");
  }
  return { valid: errors.length === 0, errors };
}

function buildProposal(planId, label, objective, currentWeights, targetWeights, constraints, rationale) {
  const target = normalizeWeights(targetWeights);
  const actions = Object.keys(target).sort().map((instrumentId) => ({
    instrument_id: instrumentId,
    from_weight: round(currentWeights[instrumentId] || 0),
    to_weight: round(target[instrumentId] || 0),
    delta_weight: round((target[instrumentId] || 0) - (currentWeights[instrumentId] || 0)),
    side: target[instrumentId] > (currentWeights[instrumentId] || 0) ? "BUY_OR_HOLD_CASH" : target[instrumentId] < (currentWeights[instrumentId] || 0) ? "SELL_OR_REDUCE" : "HOLD"
  }));
  const unsignedProposal = {
    proposal_id: `proposal-${planId.toLowerCase()}-${hash(target).slice(0, 10)}`,
    plan_id: planId,
    label,
    objective,
    target_weights: target,
    actions,
    constraints: { ...constraints, max_turnover: constraints.max_turnover },
    turnover: turnoverBetween(currentWeights, target),
    rationale,
    expected_metrics: {
      max_single_asset_weight: round(Math.max(...Object.entries(target).filter(([id]) => id !== "CASH").map((entry) => entry[1]))),
      cash_weight: round(target.CASH || 0)
    }
  };
  const proposal = {
    ...unsignedProposal,
    proposal_hash: hash(unsignedProposal)
  };
  proposal.validation = validateProposal(proposal, { requireHash: true });
  if (!proposal.validation.valid) {
    throw new FinancialToolError("INVALID_GENERATED_PROPOSAL", "当前组合无法同时满足演示方案的仓位与换手限制；未生成可执行调整。", proposal.validation);
  }
  return proposal;
}

function generateCandidates(snapshotOrInput, reportInput) {
  const snapshot = requireSnapshot(snapshotOrInput);
  const report = diagnosePortfolio(snapshot).output;
  if (reportInput && hash(reportInput) !== hash(report)) throw new FinancialToolError("INVALID_REPORT", "health report does not match this portfolio snapshot");
  const currentWeights = weightsFor(snapshot);
  const targetA = { ...currentWeights };
  const targetB = { ...currentWeights };
  let releasedByB = 0;
  for (const position of snapshot.positions) {
    if (targetB[position.instrument_id] > 0.2) {
      releasedByB += targetB[position.instrument_id] - 0.2;
      targetB[position.instrument_id] = 0.2;
    }
  }
  targetB.CASH += releasedByB;

  const targetC = { ...currentWeights };
  let releasedByC = 0;
  const riskClusterIds = new Set(report.hidden_clusters.flatMap((cluster) => cluster.instruments));
  for (const position of snapshot.positions) {
    if (riskClusterIds.has(position.instrument_id)) {
      const nextWeight = Math.min(targetC[position.instrument_id], 0.14);
      releasedByC += targetC[position.instrument_id] - nextWeight;
      targetC[position.instrument_id] = nextWeight;
    }
  }
  targetC.ETF_BOND = (targetC.ETF_BOND || 0) + releasedByC * 0.7;
  targetC.CASH = (targetC.CASH || 0) + releasedByC * 0.3;

  const candidates = [
    buildProposal("A", "Keep / minimum action", "preserve the current allocation and avoid unnecessary turnover", currentWeights, targetA, {
      max_single_asset_weight: 0.35,
      max_turnover: 0.05,
      objective: "minimum_action"
    }, ["No hard constraint is currently violated; keep the baseline for comparison."]),
    buildProposal("B", "Moderate rebalance", "reduce the largest position with bounded turnover", currentWeights, capSecurityWeights(targetB, 0.2), {
      max_single_asset_weight: 0.2,
      max_turnover: 0.1,
      objective: "concentration_control"
    }, ["Cap any security above 20% and move the difference to cash."]),
    buildProposal("C", "Risk priority", "reduce correlated exposure and increase the defensive sleeve", currentWeights, capSecurityWeights(targetC, 0.2), {
      max_single_asset_weight: 0.2,
      max_turnover: 0.25,
      objective: "risk_budget"
    }, ["Reduce the detected correlated cluster, then split released weight between bond ETF and cash."])
  ];
  return makeToolResult("strategy.generate", { snapshot, report }, {
    snapshot_id: snapshot.snapshot_id,
    report_id: report.report_id,
    candidates
  });
}

function evaluateCandidate(snapshot, proposal) {
  const validation = validateProposal(proposal, { requireHash: true });
  if (!validation.valid) {
    throw new FinancialToolError("INVALID_PROPOSAL", "simulation received an invalid ActionProposal", validation);
  }
  const currentWeights = weightsFor(snapshot);
  const actualTurnover = turnoverBetween(currentWeights, proposal.target_weights);
  for (const action of proposal.actions) {
    if (Math.abs(action.from_weight - (currentWeights[action.instrument_id] || 0)) > 1e-6)
      throw new FinancialToolError("INVALID_PROPOSAL", "action source weight does not match current portfolio");
  }
  if (Math.abs(actualTurnover - proposal.turnover) > 1e-6 || actualTurnover > proposal.constraints.max_turnover + 1e-6)
    throw new FinancialToolError("INVALID_PROPOSAL", "turnover does not match current portfolio");
  const transactionCost = actualTurnover * dataset.transaction_cost_rate;
  const grossPath = buildPath(snapshot, proposal.target_weights);
  const path = grossPath.map((point, i) => ({ ...point, value: i === 0 ? 1 : round(point.value * (1 - transactionCost)) }));
  return {
    plan_id: proposal.plan_id,
    proposal_id: proposal.proposal_id,
    label: proposal.label,
    turnover: proposal.turnover,
    transaction_cost: round(transactionCost),
    metrics: metricsFromPath(path),
    curve: path
  };
}

function scenarioDistribution(weights, transactionCost, seed, pathCount = DEFAULT_SCENARIO_PATHS) {
  const ids = Object.keys(weights).filter(id => id !== "CASH");
  const jointReturns = dataset.price_history.dates.slice(1).map((_, i) =>
    ids.map(id => getPriceSeries(id)[i + 1] / getPriceSeries(id)[i] - 1));
  const random = seededRandom(seed);
  const blockSize = 3;
  const horizon = 20;
  const outcomes = [];
  for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
    const holdings = ids.map(id => weights[id]);
    let steps = 0;
    while (steps < horizon) {
      const start = Math.floor(random() * Math.max(1, jointReturns.length - blockSize + 1));
      for (let offset = 0; offset < blockSize && steps < horizon; offset += 1) {
        const row = jointReturns[start + offset];
        holdings.forEach((value, i) => { holdings[i] = value * (1 + row[i]); });
        steps += 1;
      }
    }
    outcomes.push((sum(holdings) + (weights.CASH || 0)) * (1 - transactionCost) - 1);
  }
  return {
    method: "block_bootstrap",
    block_size: blockSize,
    paths: pathCount,
    seed,
    horizon_days: horizon,
    sampling: "joint asset daily returns; identical block indices across Current/A/B/C",
    p10: quantile(outcomes, 0.1),
    p50: quantile(outcomes, 0.5),
    p90: quantile(outcomes, 0.9)
  };
}

function runSimulation(snapshotOrInput, proposalsInput) {
  const snapshot = requireSnapshot(snapshotOrInput);
  const candidates = Array.isArray(proposalsInput)
    ? proposalsInput
    : generateCandidates(snapshot).output.candidates;
  const comparisons = candidates.map((proposal) => evaluateCandidate(snapshot, proposal));
  const currentProposal = buildProposal(
    "CURRENT",
    "Current portfolio",
    "use the current allocation as the baseline for comparison",
    weightsFor(snapshot),
    weightsFor(snapshot),
    { max_single_asset_weight: 1, max_turnover: 0, objective: "baseline" },
    ["Baseline has zero turnover and is used only for comparison."]
  );
  const current = evaluateCandidate(snapshot, currentProposal);
  const allComparisons = [current, ...comparisons];
  const scenarios = allComparisons.map((comparison, index) => ({
    plan_id: comparison.plan_id,
    distribution: scenarioDistribution([currentProposal, ...candidates][index].target_weights, comparison.transaction_cost, DEFAULT_SCENARIO_SEED)
  }));
  return makeToolResult("simulation.run", { snapshot, candidates, seed: DEFAULT_SCENARIO_SEED }, {
    simulation_id: `simulation-${hash({ snapshot: snapshot.snapshot_id, candidates }).slice(0, 16)}`,
    snapshot_id: snapshot.snapshot_id,
    historical_window: {
      start: dataset.price_history.dates[0],
      end: dataset.price_history.dates[dataset.price_history.dates.length - 1]
    },
    transaction_cost_rate: dataset.transaction_cost_rate,
    assumptions: {
      data_mode: "SYNTHETIC_REPLAY", initial_capital: snapshot.total_value, annualization_factor: 252,
      risk_free_rate: 0.02, portfolio_method: "buy-and-hold", cost_basis: "one-way turnover times rate charged once",
      sample_observations: dataset.price_history.dates.length,
      caveat: "Ex-post allocation comparison on a short synthetic window, not an out-of-sample strategy backtest."
    },
    comparisons: allComparisons,
    scenarios,
    limitation: "Historical replay and fixed-seed scenario simulation are not a prediction of future returns."
  });
}

function paperTrade({ snapshot: snapshotInput, proposal, approval, idempotency_key: idempotencyKey }) {
  if (!idempotencyKey) throw new FinancialToolError("IDEMPOTENCY_KEY_REQUIRED", "paper trade requires idempotency_key");
  if (paperReceipts.has(idempotencyKey)) {
    return makeToolResult("paper-trade.execute", { idempotencyKey }, {
      status: "IDEMPOTENT_REPLAY",
      receipt: clone(paperReceipts.get(idempotencyKey))
    });
  }
  if (!approval || approval.status !== "APPROVED" || !approval.token) {
    return makeToolResult("paper-trade.execute", { proposal, idempotencyKey }, {
      status: "REQUIRES_APPROVAL",
      reason: "Paper Trading tool accepts an approval contract but does not create or bypass Safety approval."
    });
  }
  const snapshot = requireSnapshot(snapshotInput || getDemoPortfolio());
  if (!proposal || !proposal.target_weights || !proposal.proposal_hash) {
    throw new FinancialToolError("INVALID_PROPOSAL", "paper trade requires a structured ActionProposal");
  }
  const validation = validateProposal(proposal, { requireHash: true });
  if (!validation.valid) throw new FinancialToolError("INVALID_PROPOSAL", "paper trade received an invalid ActionProposal", validation);
  const receipt = {
    receipt_id: `paper-${hash({ snapshot: snapshot.snapshot_id, proposal: proposal.proposal_hash, idempotencyKey }).slice(0, 16)}`,
    idempotency_key: idempotencyKey,
    status: "FILLED",
    mode: "PAPER",
    proposal_id: proposal.proposal_id,
    approval_token_hash: hash(approval.token).slice(0, 16),
    updated_portfolio: {
      ...clone(snapshot),
      target_weights: clone(proposal.target_weights),
      simulated_at: dataset.as_of
    }
  };
  paperReceipts.set(idempotencyKey, receipt);
  return makeToolResult("paper-trade.execute", { snapshot, proposal, idempotencyKey }, {
    status: "FILLED",
    receipt: clone(receipt)
  });
}

function resetPaperTrading() {
  paperReceipts.clear();
}

module.exports = {
  FinancialToolError,
  getDemoPortfolio,
  validatePortfolio,
  diagnosePortfolio,
  generateCandidates,
  runSimulation,
  validateProposal,
  paperTrade,
  resetPaperTrading,
  constants: {
    TOOL_VERSION,
    DATA_AS_OF: dataset.as_of,
    SCENARIO_SEED: DEFAULT_SCENARIO_SEED,
    SCENARIO_PATHS: DEFAULT_SCENARIO_PATHS
  }
};

},
"merchant/ledger.js":function(module,exports,require){
"use strict";

const { createHash } = require("node:crypto");
const AS_OF = "2026-10-04";
const clone = (value) => structuredClone(value);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const day = (date, offset) => new Date(Date.parse(date + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
const validDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function fail(code, message) { throw Object.assign(new Error(message), { code, statusCode: 422 }); }
function demo() {
  const bill = (id, channel, kind, category, booked_on, due_on, amount_cents, extra = {}) => ({
    id, channel, kind, category, booked_on, due_on, amount_cents, fee_cents: 0,
    refund_cents: 0, status: "pending", source: channel + "演示账单/" + id,
    description: category, ...extra
  });
  return {
    version: "merchant-demo@1", shop: "巷口咖啡", currency: "CNY", as_of: AS_OF,
    balance_cents: 620000, balance_note: "10月4日收盘已核对银行与现金余额，已到账收支已包含其中",
    bills: [
      bill("WX-001", "微信", "income", "门店销售", "2026-10-02", "2026-10-03", 240000, { fee_cents: 1440, status: "settled" }),
      bill("ALI-001", "支付宝", "income", "门店销售", "2026-10-03", "2026-10-04", 180000, { fee_cents: 1080, status: "settled" }),
      bill("MT-001", "外卖平台", "income", "外卖销售", "2026-10-03", "2026-10-06", 320000, { fee_cents: 25600, refund_cents: 20000, description: "周末外卖结算批次" }),
      bill("WX-002", "微信", "income", "门店销售", "2026-10-04", "2026-10-05", 210000, { fee_cents: 1260 }),
      bill("ALI-002", "支付宝", "income", "门店销售", "2026-10-04", "2026-10-05", 160000, { fee_cents: 960, refund_cents: 10000 }),
      bill("GROUP-01", "团购平台", "income", "团购核销", "2026-10-01", "2026-10-03", 90000, { fee_cents: 4500, description: "已过预计到账日，需核对结算状态" }),
      bill("BEAN-P", "供应商", "expense", "咖啡豆", "2026-09-23", "2026-09-24", 160000, { status: "settled", quantity: 20, unit: "kg", item: "拼配豆A" }),
      bill("BEAN-C", "供应商", "expense", "咖啡豆", "2026-09-30", "2026-10-05", 220000, { quantity: 25, unit: "kg", item: "拼配豆A" }),
      bill("MILK-P", "供应商", "expense", "牛奶", "2026-09-24", "2026-09-25", 90000, { status: "settled", quantity: 100, unit: "L", item: "鲜奶A" }),
      bill("MILK-C", "供应商", "expense", "牛奶", "2026-10-01", "2026-10-07", 110000, { quantity: 110, unit: "L", item: "鲜奶A" }),
      bill("PACK-P", "供应商", "expense", "包装", "2026-09-25", "2026-09-26", 40000, { status: "settled", quantity: 500, unit: "个", item: "纸杯A" }),
      bill("PACK-C", "供应商", "expense", "包装", "2026-10-02", "2026-10-08", 40000, { quantity: 500, unit: "个", item: "纸杯A" }),
      bill("RENT", "银行", "expense", "房租", "2026-10-01", "2026-10-06", 700000),
      bill("WAGE", "银行", "expense", "工资", "2026-10-01", "2026-10-10", 480000),
      bill("UTIL", "银行", "expense", "水电", "2026-10-01", "2026-10-09", 65000)
    ]
  };
}
function validate(input) {
  if (!input || Array.isArray(input) || input.currency !== "CNY" || !validDay(input.as_of) ||
      !Number.isSafeInteger(input.balance_cents) || Math.abs(input.balance_cents) > 1e11 ||
      typeof input.shop !== "string" || !input.shop.trim() || input.shop.length > 100 ||
      !Array.isArray(input.bills) || input.bills.length > 5000) fail("INVALID_LEDGER", "请使用 CNY、有效日期、整数分金额与最多 5000 条账单。");
  const unique = new Map();
  let duplicates = 0;
  for (const bill of input.bills) {
    if (!bill || typeof bill !== "object") fail("INVALID_BILL", "账单必须为对象。");
    for (const key of ["id", "channel", "category", "source", "description"]) {
      if (typeof bill[key] !== "string" || !bill[key].trim() || bill[key].length > 500) fail("INVALID_BILL", key + " 缺失或过长。");
    }
    if (!["income", "expense"].includes(bill.kind) || !["pending", "settled"].includes(bill.status) ||
        !validDay(bill.booked_on) || !validDay(bill.due_on) || bill.booked_on > input.as_of ||
        bill.due_on < bill.booked_on || (bill.status === "settled" && bill.due_on > input.as_of)) fail("INVALID_BILL", bill.id + " 日期或状态无效。");
    for (const key of ["amount_cents", "fee_cents", "refund_cents"]) {
      if (!Number.isSafeInteger(bill[key]) || bill[key] < 0 || bill[key] > 1e10) fail("INVALID_MONEY", bill.id + " 金额必须是非负整数分。");
    }
    if (bill.fee_cents + bill.refund_cents > bill.amount_cents ||
        (bill.kind === "expense" && (bill.fee_cents || bill.refund_cents))) fail("INVALID_MONEY", bill.id + " 扣款与账单金额不一致。");
    if (bill.quantity !== undefined && (!(bill.quantity > 0) || !Number.isFinite(bill.quantity) || bill.quantity > 1e9 ||
        typeof bill.unit !== "string" || !bill.unit || bill.unit.length > 50 ||
        typeof bill.item !== "string" || !bill.item || bill.item.length > 200)) fail("INVALID_QUANTITY", "数量须为有效正数，并附单位与品名。");
    const normalized = Object.fromEntries(["id", "channel", "kind", "category", "booked_on", "due_on", "amount_cents", "fee_cents",
      "refund_cents", "status", "source", "description", "quantity", "unit", "item"].filter(k => bill[k] !== undefined).map(k => [k, bill[k]]));
    const key = bill.channel + ":" + bill.id;
    if (unique.has(key)) {
      if (JSON.stringify(unique.get(key)) !== JSON.stringify(normalized)) fail("DUPLICATE_CONFLICT", key + " 同一账单有不同金额或状态，请先核对。");
      duplicates++;
    } else unique.set(key, normalized);
  }
  const bills = [...unique.values()].sort((a, b) => (a.channel + a.id).localeCompare(b.channel + b.id, "en"));
  const ledger = { shop: input.shop, currency: "CNY", as_of: input.as_of, balance_cents: input.balance_cents, bills };
  const revision = createHash("sha256").update(JSON.stringify(ledger)).digest("hex");
  return { ledger, revision, duplicates };
}
function net(bill) { return bill.amount_cents - bill.fee_cents - bill.refund_cents; }
function ref(bill) { return bill.channel + ":" + bill.id; }
function costs(ledger) {
  const start = day(ledger.as_of, -6), previousStart = day(ledger.as_of, -13), previousEnd = day(ledger.as_of, -7);
  return [...new Set(ledger.bills.filter(b => b.kind === "expense").map(b => b.category))].map(category => {
    const relevant = ledger.bills.filter(b => b.kind === "expense" && b.category === category);
    const current = relevant.filter(b => b.booked_on >= start && b.booked_on <= ledger.as_of);
    const previous = relevant.filter(b => b.booked_on >= previousStart && b.booked_on <= previousEnd);
    const currentValue = sum(current.map(b => b.amount_cents)), previousValue = sum(previous.map(b => b.amount_cents));
    const all = [...previous, ...current];
    const comparable = previous.length && current.length && all.every(b => b.quantity && b.unit === all[0].unit && b.item === all[0].item);
    let decomposition = null;
    if (comparable) {
      const q0 = sum(previous.map(b => b.quantity)), q1 = sum(current.map(b => b.quantity));
      const p0 = previousValue / q0, p1 = currentValue / q1;
      const quantityEffect = Math.round((q1 - q0) * p0);
      decomposition = { unit: all[0].unit, previous_quantity: q0, current_quantity: q1,
        previous_unit_cents: Math.round(p0), current_unit_cents: Math.round(p1),
        quantity_effect_cents: quantityEffect, price_effect_cents: currentValue - previousValue - quantityEffect };
    }
    return { category, current_cents: currentValue, previous_cents: previousValue, delta_cents: currentValue - previousValue,
      change_ratio: previousValue ? (currentValue - previousValue) / previousValue : null, decomposition,
      current_window: [start, ledger.as_of], previous_window: [previousStart, previousEnd], evidence: all.map(ref) };
  }).sort((a, b) => b.delta_cents - a.delta_cents);
}
function forecast(ledger, delayDays = 0, singleRef = null) {
  if (![0, 3, 7].includes(delayDays)) fail("INVALID_DELAY", "到账延迟只支持 0、3、7 天。");
  const pending = ledger.bills.filter(b => b.status === "pending");
  let expected = ledger.balance_cents, conservative = ledger.balance_cents;
  const days = [];
  for (let i = 1; i <= 14; i++) {
    const date = day(ledger.as_of, i);
    // Overdue payments are reserved tomorrow; overdue receipts stay uncertain.
    const incoming = pending.filter(b => b.kind === "income" && b.due_on > ledger.as_of &&
      (singleRef && ref(b) !== singleRef ? b.due_on === date : day(b.due_on, delayDays) === date));
    const outgoing = pending.filter(b => b.kind === "expense" && (b.due_on <= ledger.as_of ? i === 1 : b.due_on === date));
    const incomingCents = sum(incoming.map(net)), outgoingCents = sum(outgoing.map(net));
    expected += incomingCents - outgoingCents; conservative -= outgoingCents;
    days.push({ date, incoming_cents: incomingCents, outgoing_cents: outgoingCents,
      expected_cents: expected, conservative_cents: conservative, evidence: [...incoming, ...outgoing].map(ref) });
  }
  const openingGap = ledger.balance_cents < 0 ? { date: ledger.as_of, expected_cents: ledger.balance_cents,
    conservative_cents: ledger.balance_cents, incoming_cents: 0, outgoing_cents: 0, evidence: [], opening: true } : null;
  return { delay_days: delayDays, days, first_gap: openingGap || days.find(d => d.expected_cents < 0) || null,
    min_expected_cents: Math.min(ledger.balance_cents, ...days.map(d => d.expected_cents)),
    excluded_overdue_receipts: pending.filter(b => b.kind === "income" && b.due_on <= ledger.as_of).map(ref) };
}
class MerchantSession {
  constructor(input = demo()) { this.replace(input); }
  replace(input) {
    const checked = validate(input);
    this.ledger = checked.ledger; this.revision = checked.revision; this.duplicates = checked.duplicates;
    this.reviewed = false; this.viewed = new Set(); this.followups = new Set(); this.noticeStates = new Map();
    return this.summary();
  }
  summary(delay = 0) {
    const l = this.ledger, pending = l.bills.filter(b => b.status === "pending");
    return { ledger: clone(l), revision: this.revision, reviewed: this.reviewed, duplicates: this.duplicates,
      viewed: [...this.viewed], followups: [...this.followups],
      totals: { balance_cents: l.balance_cents, receivable_cents: sum(pending.filter(b => b.kind === "income").map(net)),
        payable_cents: sum(pending.filter(b => b.kind === "expense").map(net)) },
      costs: costs(l), forecast: forecast(l, delay),
      warnings: ["账单基准日期 " + l.as_of + "；余额以手动核对为准。", "预计到账不等于承诺到账；这里只包含已知账单，不推测未来销售。"] };
  }
  detail(key) {
    const b = this.ledger.bills.find(b => ref(b) === key);
    if (!b) fail("BILL_NOT_FOUND", "账单不存在。");
    this.viewed.add(key);
    return { ...clone(b), net_cents: net(b), balance_effect: b.status === "settled" ? "已包含在当前余额" : "尚未进入当前余额" };
  }
  review(revision, confirmed) {
    if (revision !== this.revision) fail("STALE_REVIEW", "账单已更新，请重新查看。");
    if (confirmed !== true || this.viewed.size === 0) fail("REVIEW_REQUIRED", "请先打开一笔账单，再明确确认已看懂口径。");
    this.reviewed = true;
    return { reviewed: true, revision: this.revision };
  }
  insights(delay = 0) {
    if (!this.reviewed) fail("REVIEW_REQUIRED", "先看清账单，再查看提醒。");
    const s = this.summary(delay), notices = [];
    if (s.forecast.first_gap) notices.push({ id: "cash-gap", title: s.forecast.first_gap.date + (s.forecast.first_gap.opening ? " 当前余额已为负数" : " 已知账单可能形成资金缺口"),
      amount_cents: -s.forecast.first_gap.expected_cents,
      explanation: s.forecast.first_gap.opening ? "缺口来自输入的当前余额，不是未来账单造成的。请先核对银行余额、现金及透支记录。" :
        "按当前余额、预计到账和已知付款逐日计算。先核对到账，再与房东或供应商讨论付款时间。",
      evidence: [...new Set(s.forecast.days.filter(d => d.date <= s.forecast.first_gap.date).flatMap(d => d.evidence))] });
    const overdue = s.ledger.bills.filter(b => b.kind === "income" && b.status === "pending" && b.due_on <= s.ledger.as_of);
    if (overdue.length) notices.push({ id: "overdue", title: "有结算款已到预计到账日但未确认", amount_cents: sum(overdue.map(net)),
      explanation: "这部分未计入预计余额。请先对照平台结算单和银行记录，确认状态。", evidence: overdue.map(ref) });
    for (const c of s.costs.filter(c => c.change_ratio !== null && c.change_ratio > 0.1)) {
      notices.push({ id: "cost-" + c.category, title: c.category + " 本期采购支出增加",
        amount_cents: c.delta_cents, explanation: c.decomposition ?
          "同品同单位拆分数量和单价变化。先核对采购批次与单价，再考虑询价；采购支出不等于已消耗成本。" :
          "没有可比数量资料，暂时只能确认支出变化，不能判断单价上涨。", evidence: c.evidence });
    }
    return { notices: notices.map(n => {
      const saved = this.noticeStates.get(n.id) || {};
      return { ...n, following: this.followups.has(n.id), status: saved.status || "open", note: saved.note || "" };
    }), revision: this.revision,
      digest: "本次已核对 " + this.viewed.size + " 笔来源，共 " + this.ledger.bills.length + " 笔账单。下次从未查看的账单开始。" };
  }
  setNoticeStatus(id, status, note) {
    if (!["open", "verified", "done"].includes(status)) fail("INVALID_NOTICE_STATUS", "提醒状态无效。");
    if (!this.insights().notices.some(n => n.id === id)) fail("NOTICE_NOT_FOUND", "提醒不存在。");
    if (note !== undefined && (typeof note !== "string" || note.length > 240)) fail("INVALID_NOTICE_NOTE", "处理备注请控制在 240 个字符以内。");
    const previous = this.noticeStates.get(id) || {};
    this.noticeStates.set(id, { status, note: note === undefined ? (previous.note || "") : note.trim() });
    return { id, status };
  }
  singleScenario(key, delayDays = 0) {
    if (![0, 3, 7].includes(delayDays)) fail("INVALID_DELAY", "单笔到账延迟只支持 0、3、7 天。");
    const bill = this.ledger.bills.find(item => ref(item) === key);
    if (!bill) fail("BILL_NOT_FOUND", "账单不存在。");
    if (bill.kind !== "income" || bill.status !== "pending" || bill.due_on <= this.ledger.as_of) {
      fail("INVALID_SCENARIO_BILL", "只能试算尚未到账且尚未过预计日期的收入账单。");
    }
    const baseline = forecast(this.ledger, 0), scenario = forecast(this.ledger, delayDays, key);
    const compact = value => ({ first_gap: value.first_gap, min_expected_cents: value.min_expected_cents });
    return { bill: { ...clone(bill), net_cents: net(bill) }, delay_days: delayDays,
      moved_from: bill.due_on, moved_to: day(bill.due_on, delayDays),
      baseline: compact(baseline), scenario: compact(scenario) };
  }
  follow(id, delay = 0) {
    if (!this.insights(delay).notices.some(n => n.id === id)) fail("NOTICE_NOT_FOUND", "提醒不存在。");
    this.followups.has(id) ? this.followups.delete(id) : this.followups.add(id);
    return { following: this.followups.has(id) };
  }
}
module.exports = { MerchantSession, demo, validate, net, costs, forecast, day };

},
"data/demo-portfolio.json":function(module,exports,require){
module.exports={
  "dataset_version": "golden-demo-v1",
  "as_of": "2026-09-23T08:00:00Z",
  "transaction_cost_rate": 0.001,
  "scenario_seed": 20260924,
  "portfolio": {
    "portfolio_id": "golden-demo-portfolio",
    "as_of": "2026-09-23T08:00:00Z",
    "cash": 10000,
    "positions": [
      {
        "instrument_id": "EQUITY_ALPHA",
        "name": "Alpha Holdings",
        "type": "A_SHARE",
        "sector": "Technology",
        "quantity": 100,
        "price": 47.2
      },
      {
        "instrument_id": "ETF_GROWTH",
        "name": "Growth ETF",
        "type": "ETF",
        "sector": "Technology",
        "quantity": 100,
        "price": 75.5
      },
      {
        "instrument_id": "ETF_CONSUMER",
        "name": "Consumer ETF",
        "type": "ETF",
        "sector": "Consumer",
        "quantity": 100,
        "price": 47.6
      },
      {
        "instrument_id": "ETF_BOND",
        "name": "Bond ETF",
        "type": "ETF",
        "sector": "Fixed Income",
        "quantity": 100,
        "price": 40.5
      }
    ]
  },
  "instrument_metadata": {
    "EQUITY_ALPHA": { "type": "A_SHARE", "lot_size": 100 },
    "ETF_GROWTH": { "type": "ETF", "lot_size": 100 },
    "ETF_CONSUMER": { "type": "ETF", "lot_size": 100 },
    "ETF_BOND": { "type": "ETF", "lot_size": 100 }
  },
  "price_history": {
    "dates": [
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23"
    ],
    "prices": {
      "EQUITY_ALPHA": [50, 49.4, 48.8, 49.6, 48.1, 48.4, 47.2],
      "ETF_GROWTH": [80, 78.6, 77.5, 79.1, 76.4, 77.3, 75.5],
      "ETF_CONSUMER": [50, 49.1, 48.6, 49.2, 47.9, 48.2, 47.6],
      "ETF_BOND": [40, 40.1, 40.2, 40.1, 40.3, 40.4, 40.5]
    }
  }
}
;
}},cache={};
const cryptoShim={randomUUID:()=>crypto.randomUUID(),createHash(algorithm){if(algorithm!=='sha256')throw new Error('Only SHA-256 is supported');let input='';return {update(value){input+=String(value);return this;},digest(format){if(format!=='hex')throw new Error('Only hex is supported');return sha256(input);}};}};
function load(id,from=''){if(id==='node:crypto')return cryptoShim;let key=id;if(id.startsWith('.')){const parts=from.split('/');parts.pop();for(const part of id.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part);}key=parts.join('/');}if(!/\.(js|json)$/.test(key))key+='.js';if(cache[key])return cache[key].exports;if(!factories[key])throw new Error('Unknown demo module '+key);const module={exports:{}};cache[key]=module;factories[key](module,module.exports,name=>load(name,key));return module.exports;}
const {Harness}=load('core/harness.js'),tools=load('tools/financial-tools.js'),{MerchantSession,demo:merchantDemo}=load('merchant/ledger.js');
const harness=new Harness({toolset:tools});let merchantSession;function merchantFor(){return merchantSession||(merchantSession=new MerchantSession());}
function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, error, fallbackStatus = 400) {
  const status = error.statusCode || (error.code === "INVALID_PORTFOLIO" ? 422 : fallbackStatus);
  sendJson(response, status, {
    error: {
      code: error.code || "REQUEST_FAILED",
      message: error.message,
      details: error.details || null
    }
  });
}

function sendDownload(response, filename, payload) {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(filename) });
  response.end(JSON.stringify(payload, null, 2));
}


async function parseBody(request){const text=request.bodyText||'';if(text.length>1024*1024)throw Object.assign(new Error('request body exceeds 1 MB'),{statusCode:413});if(!text)return {};try{return JSON.parse(text);}catch(error){error.statusCode=400;error.code='INVALID_JSON';throw error;}}
function resolvePortfolio(body) {
  if (body && body.snapshot) return body.snapshot;
  if (body && body.portfolio) return body.portfolio;
  return body && Object.keys(body).length ? body : tools.getDemoPortfolio();
}

function resolveSnapshot(body) {
  const input = resolvePortfolio(body);
  if (input.snapshot_id) return input;
  const result = tools.validatePortfolio(input);
  if (!result.output.valid) {
    const error = new Error("portfolio validation failed");
    error.code = "INVALID_PORTFOLIO";
    error.details = result.output;
    throw error;
  }
  return result.output.snapshot;
}

async function handleApi(request, response, pathname, url) {
  const method = request.method || "GET";
  let body = {};
  if (method === "POST") body = await parseBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("JSON body must be an object");
  if (pathname.startsWith("/api/merchant/")) {
    const session = merchantFor(request, response);
    let result;
    const delay = Number(url.searchParams.get("delay") || 0);
    if (method === "GET" && pathname === "/api/merchant/export") {
      const type = url.searchParams.get("type") || "ledger";
      if (!["ledger", "review", "demo"].includes(type)) throw new Error("unknown export type");
      const s = session.summary(delay);
      const payload = type === "demo" ? merchantDemo() : type === "ledger" ? s.ledger :
        { ledger: s.ledger, revision: s.revision, forecast: s.forecast, costs: s.costs,
          review: session.insights(delay), scope: "已知账单测算；预计日期待核实；未连接支付平台" };
      sendDownload(response, "merchant-" + type + "-" + s.ledger.as_of + ".json", payload); return true;
    }
    if (method === "GET" && pathname === "/api/merchant/ledger") result = session.summary(delay);
    else if (method === "GET" && pathname === "/api/merchant/demo") result = merchantDemo();
    else if (method === "GET" && pathname === "/api/merchant/bill") result = session.detail(url.searchParams.get("id"));
    else if (method === "GET" && pathname === "/api/merchant/scenario") result = session.singleScenario(url.searchParams.get("bill"), delay);
    else if (method === "GET" && pathname === "/api/merchant/insights") result = session.insights(delay);
    else if (method === "POST" && pathname === "/api/merchant/review") result = session.review(body.revision, body.confirmed);
    else if (method === "POST" && pathname === "/api/merchant/import") result = session.replace(body);
    else if (method === "POST" && pathname === "/api/merchant/follow") result = session.follow(body.id, body.delay || 0);
    else if (method === "POST" && pathname === "/api/merchant/notice") result = session.setNoticeStatus(body.id, body.status, body.note);
    else if (method === "POST" && pathname === "/api/merchant/reset") result = session.replace(merchantDemo());
    else return false;
    sendJson(response, 200, result); return true;
  }
  if (method === "GET" && pathname.startsWith("/api/task/")) {
    const exporting = pathname.endsWith("/export");
    const taskId = pathname.slice("/api/task/".length, exporting ? -"/export".length : undefined);
    const task = harness.getTask(taskId);
    if (task && exporting) { sendDownload(response, "portfolio-analysis.json", task); return true; }
    sendJson(response, task ? 200 : 404, task || { error: { code: "TASK_NOT_FOUND", message: "task not found" } }); return true;
  }

  if (method === "GET" && pathname === "/api/demo/portfolio") {
    sendJson(response, 200, tools.validatePortfolio(tools.getDemoPortfolio()));
    return true;
  }
  if (method === "POST" && pathname === "/api/session/init") {
    sendJson(response, 200, harness.createSession(body));
    return true;
  }
  if (method === "POST" && pathname === "/api/health-check/run") {
    const result = harness.runHealthCheck({
      task_id: body.task_id,
      session_id: body.session_id,
      risk_profile: body.risk_profile,
      portfolio: body.portfolio || body.snapshot
    });
    sendJson(response, 200, result);
    return true;
  }
  if (method === "POST" && pathname === "/api/portfolio/import") {
    sendJson(response, 200, tools.validatePortfolio(resolvePortfolio(body)));
    return true;
  }
  if (method === "POST" && pathname === "/api/portfolio/diagnose") {
    sendJson(response, 200, tools.diagnosePortfolio(resolvePortfolio(body)));
    return true;
  }
  if (method === "POST" && pathname === "/api/strategy/generate") {
    const snapshot = resolveSnapshot(body);
    const report = body.health_report || body.report || tools.diagnosePortfolio(snapshot).output;
    sendJson(response, 200, tools.generateCandidates(snapshot, report));
    return true;
  }
  if (method === "POST" && pathname === "/api/simulation/run") {
    const snapshot = resolveSnapshot(body);
    const candidates = body.candidates || body.proposals;
    sendJson(response, 200, tools.runSimulation(snapshot, candidates));
    return true;
  }
  if (method === "POST" && pathname === "/api/paper-trade/execute") {
    sendJson(response, 503, { error: { code: "GATEWAY_NOT_CONNECTED",
      message: "Safety Action Gateway 尚未接入；客户端提交的 approval 不能作为执行授权。" } });
    return true;
  }
  if (method === "GET" && pathname.startsWith("/api/audit/")) {
    const taskId = decodeURIComponent(pathname.slice("/api/audit/".length));
    const audit = harness.getAudit(taskId);
    if (!audit) {
      sendJson(response, 404, { error: { code: "TASK_NOT_FOUND", message: "task not found" } });
    } else {
      sendJson(response, 200, audit);
    }
    return true;
  }
  if (method === "POST" && pathname === "/api/memory/save") {
    sendJson(response, 200, harness.saveMemory(body.task_id, body.record));
    return true;
  }
  if (method === "GET" && pathname === "/api/memory") {
    sendJson(response, 200, { session_id: url.searchParams.get("session_id"), entries: harness.listMemory(url.searchParams.get("session_id")) });
    return true;
  }
  if (method === "POST" && pathname === "/api/memory/clear") {
    sendJson(response, 200, harness.memory.clear(body.session_id));
    return true;
  }
  if (method === "POST" && pathname === "/api/demo/reset") {
    harness.reset();
    tools.resetPaperTrading();
    sendJson(response, 200, { reset: true, data_as_of: tools.constants.DATA_AS_OF });
    return true;
  }
  return false;
}


(function browserAdapter() {
  const nativeFetch=window.fetch.bind(window);
  // —— 连接模式：live = 真链路（serve.py 代理到团队后端）；demo = 内置演示 harness。
  // 每页通过 <html data-source="backend|demo|none"> 声明本页数据来源，右下角徽标如实显示。
  let __mode='unknown';
  function dataSource(){
    const attr=document.documentElement.getAttribute('data-source');
    return attr==='backend'||attr==='demo'?attr:'none';
  }
  function renderModePill(){
    if(!document.body){document.addEventListener('DOMContentLoaded',()=>renderModePill(),{once:true});return;}
    const source=dataSource();
    let pill=document.getElementById('fl-mode-pill');
    if(!pill){
      pill=document.createElement('div');
      pill.id='fl-mode-pill';
      const style=document.createElement('style');
      style.textContent='#fl-mode-pill{position:fixed;right:14px;bottom:14px;z-index:99;font-size:11px;letter-spacing:.4px;padding:7px 12px;border-radius:999px;color:#f3eee8;background:rgba(25,23,21,.86);border:1px solid rgba(232,216,195,.22);backdrop-filter:blur(12px);}'
        +'#fl-mode-pill[data-mode="live"]{color:#d7f7e4;border-color:rgba(103,220,150,.45);}'
        +'#fl-mode-pill[data-mode="demo"]{color:#ffd9b3;border-color:rgba(255,145,74,.5);}'
        +'#fl-mode-pill[data-source="none"]{display:none;}';
      document.head.appendChild(style);
      document.body.appendChild(pill);
    }
    pill.dataset.source=source;
    if(source==='none'){pill.style.display='none';return;}
    pill.style.display='';
    if(source==='demo'){
      pill.dataset.mode='demo';
      pill.textContent='● 本页演示数据 · 未接团队后端';
      return;
    }
    pill.dataset.mode=__mode;
    pill.textContent=__mode==='live'?'● 真链路已连接 · 团队后端':__mode==='demo'?'● 演示模式 · 团队后端未连接':'○ 连接检测中…';
  }
  function setMode(mode){
    if(__mode===mode)return;
    __mode=mode;
    renderModePill();
    window.dispatchEvent(new CustomEvent('finance-lab-mode',{detail:mode}));
  }
  renderModePill();
  window.FinanceLab={
    get mode(){return __mode;},
    onModeChange(fn){window.addEventListener('finance-lab-mode',e=>fn(e.detail));},
  };
  window.fetch=async function(input,init={}) {
    const url=new URL(input instanceof Request?input.url:String(input),location.href);
    if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return nativeFetch(input,init);
    const signal=init.signal||(input instanceof Request?input.signal:null);
    if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
    // 真链路优先：同源 /api 由 serve.py 代理到团队后端时直接使用真实响应；
    // 后端未启动（503 BACKEND_UNAVAILABLE）或路由不在白名单（404）时回退演示 harness。
    if(typeof AbortController!=='undefined'){
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),4000);
      try{
        const liveInit={};
        if(init.method)liveInit.method=init.method;
        if(init.headers)liveInit.headers=init.headers;
        if(init.body!==undefined)liveInit.body=init.body;
        const live=await nativeFetch(url,Object.assign(liveInit,{signal:controller.signal}));
        clearTimeout(timer);
        let fallback=false;
        if(live.status===503){
          try{const probe=await live.clone().json();if(probe&&probe.error&&probe.error.code==='BACKEND_UNAVAILABLE')fallback=true;}catch(_){}
        }else if(live.status===404){
          fallback=true;
          const ctype=live.headers.get('content-type')||'';
          if(ctype.includes('application/json')){
            try{const probe=await live.clone().json();if(probe&&probe.error&&probe.error.code&&probe.error.code!=='API_NOT_FOUND')fallback=false;}catch(_){}
          }
        }
        if(!fallback){if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');setMode('live');return live;}
      }catch(_){clearTimeout(timer);}
    }
    setMode('demo');
    const request={method:(init.method||(input instanceof Request?input.method:'GET')).toUpperCase(),bodyText:init.body!==undefined?String(init.body):(input instanceof Request?await input.text():'')};
    let status=200,headers={},payload='';
    const response={headersSent:false,setHeader(name,value){headers[name]=value;},writeHead(code,values){status=code;Object.assign(headers,values);this.headersSent=true;},end(value){payload=value||'';}};
    try{if(!await handleApi(request,response,url.pathname,url))sendJson(response,404,{error:{code:'API_NOT_FOUND',message:'API route not found'}});}
    catch(error){sendError(response,error);}
    if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
    return new Response(payload,{status,headers});
  };
  // Download links normally bypass fetch. Keep demo exports local as well.
  document.addEventListener('click',async event=>{
    const anchor=event.target.closest('a[href]');if(!anchor)return;
    const url=new URL(anchor.href,location.href);if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return;
    event.preventDefault();
    try{const response=await fetch(url);if(!response.ok)throw new Error((await response.json()).error?.message||'导出失败');
      const blob=URL.createObjectURL(await response.blob()),download=document.createElement('a');download.href=blob;
      const filename=response.headers.get('content-disposition')?.split("UTF-8''")[1];download.download=filename?decodeURIComponent(filename):'finance-lab-demo.json';download.click();setTimeout(()=>URL.revokeObjectURL(blob),1000);
    }catch(error){const status=document.querySelector('#status');if(status)status.textContent=error.message;}
  },true);
})();
})();
