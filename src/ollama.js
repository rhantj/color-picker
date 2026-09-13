// 로컬 Ollama 를 확인하고, 죽어 있으면 띄운다.
//
// 안전 규칙 넷 — 이 파일을 고칠 때 같이 지킨다.
//   1. 사용자 입력이 spawn 에 닿지 않는다. 실행 파일명도 인자도 전부 상수이거나 환경변수다.
//      검색 질의 같은 요청 데이터가 여기로 흘러오는 경로를 만들지 않는다.
//   2. 이미 응답하면 새로 띄우지 않는다. 사용자가 직접 띄운 Ollama 를 건드리지 않기 위해서다.
//   3. 단일 비행. 동시 호출이 프로세스를 여러 개 띄우면 포트가 충돌한다.
//   4. 실패는 상태로 남기고 던지지 않는다. Ollama 가 없어도 전문 검색은 계속 돌아야 한다.
//
// 신뢰 경계 — 이걸 명시하지 않으면 위 규칙 1 이 실제보다 강해 보인다.
//   환경변수(OLLAMA_BIN·OLLAMA_HOST)와 PATH 는 신뢰 대상이다. 이것들을 바꿀 수 있는 사람은
//   이미 이 프로세스와 같은 권한으로 코드를 실행할 수 있으므로, 여기서 막아도 얻는 것이 없다.
//   특히 Windows 는 확장자 없는 실행 파일명을 PATH 보다 현재 디렉터리에서 먼저 찾는다 —
//   저장소에 ollama.exe 를 심을 수 있는 사람은 server.js 도 고칠 수 있다. 그래서 절대경로 고정이나
//   바이너리 검증을 하지 않는다. 규칙 1 이 막는 것은 **요청 데이터**가 실행에 닿는 경로뿐이다.

import { spawn } from "node:child_process";

const HOST = process.env.OLLAMA_HOST ?? "127.0.0.1:11434";
const BASE = `http://${HOST}`;
const BIN = process.env.OLLAMA_BIN ?? "ollama";

const PROBE_TIMEOUT_MS = 1500;
const READY_TIMEOUT_MS = Number(process.env.OLLAMA_READY_TIMEOUT_MS ?? 20000);
const POLL_INTERVAL_MS = 300;

/** @type {{state: "unknown"|"ready"|"starting"|"unavailable", detail: string, startedByUs: boolean, models: string[], host: string}} */
let current = {
  state: "unknown",
  detail: "아직 확인하지 않았다",
  startedByUs: false,
  models: [],
  host: HOST,
};

let inflight = null;
let child = null;
let exitHookInstalled = false;

export const status = () => ({ ...current });

const STATUS_TTL_MS = 5000;
let lastProbeAt = 0;
/** 진행 중인 탐지. 동시 호출이 낡은 상태를 받지 않게 여기 합류시킨다 — refresh() 주석 참조. */
let probing = null;

/**
 * 상태를 다시 확인한다. **절대 프로세스를 띄우지 않는다** — 요청 처리 경로에서 부를 수 있어야 하기 때문이다.
 * 이게 없으면 한번 ready 로 확정된 뒤 Ollama 가 죽어도 영원히 "준비됨"으로 보고한다.
 */
export async function refresh() {
  if (inflight) return status(); // 기동 시도 중이면 그쪽 결과를 기다린다
  // **진행 중인 탐지가 있으면 거기 합류한다.**
  //
  // 이게 없으면 동시 호출한 두 번째가 아래 TTL 검사에 걸려 **아직 끝나지 않은 탐지의 낡은
  // 상태**를 받는다 — `lastProbeAt` 을 `await probe()` 앞에서 세우기 때문이다. 기동 직후에는
  // 그 낡은 상태가 `"unknown"` 이라 호출부가 "Ollama 를 쓸 수 없다" 로 물러선다.
  //
  // 17단계에서 `/api/expand` 가 구조 선택과 재질 배정을 **나란히** 부르기 시작하면서 실제로
  // 그렇게 됐다 — 재질 배정이 첫 요청마다 조용히 폴백했고, S17-G10 이 "모델 호출 1회" 로 잡았다.
  // 순차 호출만 있던 시절에는 드러날 수 없던 결함이다.
  if (probing) return probing;
  if (Date.now() - lastProbeAt < STATUS_TTL_MS) return status();
  lastProbeAt = Date.now();

  probing = (async () => {
    const models = await probe();
    // 탐지 결과를 **상태와 사유 양쪽에** 적는다. 전에는 상태가 ready 였을 때만 사유를 바꿔서,
    // 서버가 뜬 직후 탐지가 실패하면 "아직 확인하지 않았다" 가 확인한 뒤에도 남았다(D1).
    // 이미 더 구체적인 사유가 있으면 남긴다 — unavailable 의 기동 실패 사유도, ready 의 "자동 기동함" 도.
    // ready 사유는 ready 로 **바뀔 때만** 적는다. 매번 적으면 "자동 기동함" 이 TTL 뒤에 사라진다(리뷰 지적).
    if (models) {
      const detail = current.state === "ready" ? current.detail : `${HOST} 응답`;
      current = { ...current, state: "ready", detail, models };
    } else if (current.state === "ready") {
      current = { ...current, state: "unavailable", detail: `${HOST} 응답이 끊겼다`, models: [] };
    } else if (current.state === "unknown") {
      current = { ...current, state: "unavailable", detail: `${HOST} 가 응답하지 않는다`, models: [] };
    }
    return status();
  })().finally(() => {
    probing = null;
  });

  return probing;
}

/** 떠 있으면 모델 이름 배열, 아니면 null. 던지지 않는다. */
async function probe() {
  try {
    const res = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json.models) ? json.models.map((m) => m.name) : [];
  } catch {
    return null;
  }
}

// 우리가 띄운 것만 정리한다. 사용자가 직접 띄운 Ollama 는 우리 것이 아니므로 손대지 않는다.
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const stop = () => {
    if (child && !child.killed) child.kill();
  };
  process.on("exit", stop);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      stop();
      process.exit(0);
    });
  }
}

function startProcess() {
  // 인자는 리터럴이다. 셸을 거치지 않으므로 인용 문제도 인젝션 여지도 없다.
  const proc = spawn(BIN, ["serve"], {
    env: { ...process.env, OLLAMA_HOST: HOST },
    stdio: "ignore",
    windowsHide: true,
  });

  // spawn 실패(미설치 등)는 throw 가 아니라 error 이벤트로 온다.
  const failure = new Promise((resolve) => {
    proc.once("error", (err) => resolve(err.code === "ENOENT" ? `${BIN} 을 찾을 수 없다` : String(err.message)));
    proc.once("exit", (code) => resolve(`기동 직후 종료했다 (코드 ${code}). 포트 ${HOST} 가 이미 쓰이고 있을 수 있다`));
  });

  return { proc, failure };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ollama 가 응답할 때까지 확인하고, 없으면 띄운다.
 * 던지지 않는다 — 결과는 항상 상태 객체로 돌아온다.
 */
export function ensureRunning() {
  if (inflight) return inflight; // 단일 비행: 동시 호출은 같은 시도를 공유한다

  inflight = (async () => {
    const already = await probe();
    if (already) {
      current = { ...current, state: "ready", detail: `${HOST} 응답`, models: already };
      return status();
    }

    current = { ...current, state: "starting", detail: `${BIN} serve 로 기동 중`, models: [] };

    let started;
    try {
      started = startProcess();
    } catch (err) {
      current = { ...current, state: "unavailable", detail: `기동할 수 없다: ${err.message}` };
      return status();
    }

    child = started.proc;
    installExitHook();

    const deadline = Date.now() + READY_TIMEOUT_MS;
    let processFailure = null;
    started.failure.then((reason) => (processFailure = reason));

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const models = await probe();
      if (models) {
        current = { ...current, state: "ready", detail: `자동 기동함 (${HOST})`, startedByUs: true, models };
        return status();
      }
      if (processFailure) {
        child = null;
        current = { ...current, state: "unavailable", detail: processFailure, startedByUs: false };
        return status();
      }
    }

    current = {
      ...current,
      state: "unavailable",
      detail: `${READY_TIMEOUT_MS / 1000}초 안에 응답하지 않았다`,
      startedByUs: Boolean(child),
    };
    return status();
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}
