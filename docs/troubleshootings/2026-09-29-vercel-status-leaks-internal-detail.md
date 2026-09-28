# Vercel 첫 배포에서 `/api/status` 가 방문자에게 내부 상세를 보였다

## 증상

2026-09-29 첫 Vercel 배포(`color-picker-sable-alpha.vercel.app`, 커밋 `1dc4cac`)에서 누구나 부를 수 있는
`/api/status` 가 다음을 그대로 내보냈다 `[실측]`:

```
"ollama":{"state":"unavailable","detail":"127.0.0.1:11434 가 응답하지 않는다","startedByUs":false,"models":[],"host":"127.0.0.1:11434"}
```

`/api/search` 의 `rewriteError` 도 `"Ollama 를 쓸 수 없다 (127.0.0.1:11434 가 응답하지 않는다)"` 원문이었다.
이 문구들은 **루프백(자기 컴퓨터)에서만** 보이게 설계된 것이다(server.js `LOOPBACK_ONLY`).

## 원인

`LOOPBACK_ONLY` 를 **바인딩 주소(`HOST`)** 로만 판정했다. Vercel 에서는 `HOST` 환경변수를 안 넣으니 기본값
`127.0.0.1` 그대로이고, 판정이 "루프백이다" 로 나왔다. 실제로는 Vercel 이 그 앞에서 인터넷 요청을 받아 넘긴다 —
바인딩 주소가 누가 부르는지를 말해 주지 않는 환경이다.

## 해결

41단계에서 `LOOPBACK_ONLY = !process.env.VERCEL && /^(127\.|::1$|localhost$)/.test(HOST)` 로 바꿨다. `VERCEL` 은
Vercel 이 스스로 넣는 환경변수다. `S41-G7` 이 `VERCEL=1` 에서 `llm`·`embed` 상세가 안 나가는지 본다.

배포판에서는 41단계가 머지·재배포되기 전까지 여전히 샌다. 급하면 Vercel 환경변수에 `HOST=0.0.0.0` 을 넣으면 막힌다
(판정이 "루프백 아님" 이 된다).

## 재발 방지책

`S41-G7`. 다만 Vercel 말고 다른 호스팅(Render · Fly 등)에 올리면 같은 일이 난다 — 그곳의 "배포 중" 표시 환경변수를
따로 더해야 한다. 근본적으로는 "바인딩 주소로 방문자를 추정한다" 는 방식의 한계다.
