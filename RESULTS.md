# Results

## 1. 실험 요약
- 저장소: exp-vlm-browser-multimodal
- 커밋 해시: 3e4835b
- 실험 일시: 2026-05-20T15:46:25.516Z -> 2026-05-20T15:46:36.003Z
- 담당자: ai-webgpu-lab
- 실험 유형: `multimodal`
- 상태: `success`

## 2. 질문
- 브라우저 VLM 실험으로 넘기기 전에 image preprocess, first-token, answer latency 보고 경로를 먼저 고정할 수 있는가
- patch count, focus region, accuracy score, fallback metadata가 multimodal 결과 문서에 같이 남는가
- 실제 browser VLM runtime 교체 전 deterministic image-question harness로 반복 검증이 가능한가

## 3. 실행 환경
### 브라우저
- 이름: Chrome
- 버전: 147.0.7727.15

### 운영체제
- OS: Linux
- 버전: unknown

### 디바이스
- 장치명: Linux x86_64
- device class: `desktop-high`
- CPU: 16 threads
- 메모리: 32 GB
- 전원 상태: `unknown`

### GPU / 실행 모드
- adapter: navigator.gpu available
- backend: `webgpu`
- fallback triggered: `false`
- worker mode: `worker`
- cache state: `warm`
- required features: ["shader-f16"]
- limits snapshot: {"maxStorageBuffersPerShaderStage":8,"maxComputeWorkgroupStorageSize":16384}

## 4. 워크로드 정의
- 시나리오 이름: Browser VLM Multimodal Readiness
- 입력 프로필: 1280x720-3-questions
- 데이터 크기: image=lab-desk-v1; patches=240; prompts=3; focus=monitor-chart|development-board|blue-mug|orange-notebook; backend=webgpu; fallback=false; accuracy=1; automation=playwright-chromium, image=lab-desk-v1; patches=240; prompts=3; focus=monitor-chart|development-board|blue-mug|orange-notebook; backend=webgpu; fallback=false; accuracy=1; realAdapter=fallback(adapter.loadModel is not a function); automation=playwright-chromium
- dataset: multimodal-fixture-v1
- model_id 또는 renderer: deterministic-vlm-browser-v1
- 양자화/정밀도: -
- resolution: -
- context_tokens: -
- output_tokens: -

## 5. 측정 지표
### 공통
- time_to_interactive_ms: 1064 ~ 1839.3 ms
- init_ms: 334.83 ~ 336.03 ms
- success_rate: 1
- peak_memory_note: 32 GB reported by browser
- error_type: -

### VLM / Multimodal
- image_preprocess_ms: 86.2 ~ 87.5 ms
- image_to_first_token_ms: 211 ~ 212.43 ms
- answer_total_ms: 334.83 ~ 336.03 ms
- accuracy_task_score: 1
- worker modes: worker
- backends: webgpu
- fallback states: false

## 6. 결과 표
| Run | Scenario | Backend | Cache | Mean | P95 | Notes |
|---|---|---:|---:|---:|---:|---|
| 1 | Browser VLM Multimodal Readiness | webgpu | warm | 334.83 | 211 | preprocess=86.2 ms, accuracy=1 |
| 2 | Browser VLM Multimodal Readiness | webgpu | warm | 336.03 | 212.43 | preprocess=87.5 ms, accuracy=1 |

## 7. 관찰
- browser VLM multimodal readiness baseline은 backend=webgpu, fallback_triggered=false, worker_mode=worker로 기록됐다.
- multimodal summary는 image_preprocess_ms=86.2, image_to_first_token_ms=211, answer_total_ms=334.83였다.
- vlm metadata는 image=lab-desk-v1; patches=240; prompts=3; focus=monitor-chart|development-board|blue-mug|orange-notebook; backend=webgpu; fallback=false; accuracy=1; automation=playwright-chromium로 남았다.
- playwright-chromium로 수집된 automation baseline이며 headless=true, browser=Chromium 147.0.7727.15.
- 실제 runtime/model/renderer 교체 전 deterministic harness 결과이므로, 절대 성능보다 보고 경로와 재현성 확인에 우선 의미가 있다.

## 8. Real Adapter vs Deterministic
- adapter: real=vlm-xenova-smolvlm-instruct-300, deterministic=deterministic-mock
- adapter_run: real=connected, deterministic=deterministic
- success_rate: real=1, deterministic=1

## 9. 결론
- browser VLM multimodal readiness harness가 image preprocess, first token, full answer latency와 accuracy score를 같은 문서에 남기게 됐다.
- 다음 단계는 deterministic fixture를 실제 browser VLM runtime, image processor, multimodal tokenizer로 교체하되 image_preprocess/image_to_first_token/answer_total metric 구조를 유지하는 것이다.
- 이후 `bench-multimodal-latency`와 `app-browser-image-lab`의 공통 multimodal fixture 입력으로 재사용할 수 있다.

## 10. 첨부
- 스크린샷: ./reports/screenshots/01-vlm-browser-multimodal-readiness.png, ./reports/screenshots/10-vlm-browser-multimodal-real-vlm.png
- 로그 파일: ./reports/logs/01-vlm-browser-multimodal-readiness.log, ./reports/logs/10-vlm-browser-multimodal-real-vlm.log
- raw json: ./reports/raw/01-vlm-browser-multimodal-readiness.json, ./reports/raw/10-vlm-browser-multimodal-real-vlm.json
- 배포 URL: https://ai-webgpu-lab.github.io/exp-vlm-browser-multimodal/
- 관련 이슈/PR: -
