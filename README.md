# Impact Clone — 브라우저 기반 Modelica 시스템 모델링 & 시뮬레이션 플랫폼

[Modelon Impact](https://modelon.com/modelon-impact/)의 UI와 워크플로를 그대로 본떠 만든 오픈소스 클론입니다.
Modelica 텍스트가 유일한 원본(source of truth)이고, 다이어그램 편집기는 그래픽 어노테이션을 통해 그 텍스트를 편집하며,
자체 Modelica 서브셋 컴파일러가 모델을 DAE로 평탄화한 뒤 수치 솔버로 시뮬레이션하고, 결과는 브라우저에서 플롯됩니다.

> English summary at the bottom.

## 주요 기능

| 영역 | 내용 |
| --- | --- |
| **네비게이션 바** | Impact와 동일한 3개 모드 버튼(Model / Experiment / Results, 단축키 `1` `2` `3`), Diagram/Code 뷰 토글, Apps 메뉴, 설정, 도움말 |
| **Workspace 패널(좌)** | Filter 필드, PROJECTS / LIBRARIES 트리(Modelica 아이콘 렌더링), 드래그 앤 드롭, 컨텍스트 메뉴(New class, Duplicate to, Extend, Rename, Delete), 문법 오류 표시 점 |
| **Model canvas(중앙)** | Modelica `Icon`/`Diagram`/`Placement`/`Line` 어노테이션을 SVG로 렌더링, 컴포넌트 이동·회전·플립·연결·삭제, 커넥터 호환성 하이라이트, 격자·스냅, 줌/팬, 실행(Play)·Views FAB, 에러 배너, Log Viewer, 타임 슬라이더, 스티키, 플로팅 플롯 |
| **Details 패널(우)** | 모드별 탭: PROPERTIES / INFORMATION / COMPONENTS / EXPERIMENT / SIMULATIONS / CALCULATED VALUES. `Dialog` 어노테이션 기준 그룹화된 파라미터 편집, 실험 오버라이드(파란 프레임), 파라미터 스윕 `range()`/`choices()`, Analysis 설정(Start/Stop time, Interval⇄Points, Solver, Tolerance, Advanced) |
| **Code 뷰** | CodeMirror 6 기반 Modelica 편집기, 자동 저장, 문법 오류 위치 표시 |
| **컴파일러** | Modelica 3.x 서브셋 파서/프린터, 상속·수정자·연결 확장·파라미터 평가·균형 검사, 알리아스 제거·변수 전파·더미 미분 인덱스 축소 |
| **솔버** | CVode(가변 스텝 BDF), Radau5ODE(음함수 사다리꼴), ExplicitEuler, 이벤트(`when`/`reinit`/`sample`) 처리 |
| **라이브러리** | Modelica Standard Library 4.0 서브셋(Blocks, Electrical.Analog, Mechanics.Rotational/Translational, Thermal.HeatTransfer, Units, Constants, Icons — 실제 MSL 아이콘/방정식 사용, BSD-3) + 예제 10종 |
| **서버 / API** | Express 5, Impact 공개 REST API 형태(workspaces, projects, model-executables, experiments, cases, trajectories, custom-functions)를 그대로 미러링 |

## 실행 방법

요구 사항: Node.js 20.19 이상 (22 권장).

```bash
npm install
npm run dev          # 서버(8080) + 웹(5173) 동시 실행
```

브라우저에서 <http://localhost:5173> 을 열면 Home 페이지에서 `Default` 워크스페이스를 선택할 수 있습니다.
`Examples.RCCircuit` 등 예제를 열고 오른쪽의 ▶ 버튼을 누르면 컴파일·시뮬레이션이 실행되고,
`3`번 모드(Results)의 CALCULATED VALUES 탭에서 변수를 플롯에 추가할 수 있습니다.

프로덕션 빌드:

```bash
npm run build        # packages + apps 빌드 (웹은 apps/web/dist)
npm start            # 서버가 apps/web/dist를 정적 서빙 (http://localhost:8080)
```

테스트 / 타입 검사:

```bash
npm test             # vitest (core, server, web 단위 테스트)
npm run typecheck
node apps/web/e2e/smoke.mjs   # Playwright 스모크(서버+웹 기동, 시뮬레이션, 스크린샷)
```

## 저장소 구조

```
packages/core       Modelica 서브셋 컴파일러 + DAE 솔버 + 그래픽/다이어그램/편집 로직 (의존성 0)
packages/protocol   서버·웹이 공유하는 REST DTO 및 라우트 테이블
apps/server         Express 서버: 파일 기반 워크스페이스, 라이브러리 서빙, 컴파일/시뮬레이션 잡
apps/web            React 19 + Vite UI
libraries/Modelica  MSL 4.0 서브셋 (BSD-3, libraries/Modelica/LICENSE.md 참고)
libraries/Examples  예제 모델 (새 워크스페이스마다 편집 가능한 프로젝트로 복사됨)
docs/               ARCHITECTURE.md, UI_SPEC.md, LIBRARY.md
```

## 설계 문서

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 패키지 구조, 지원 Modelica 서브셋, 평탄화·시뮬레이션 알고리즘, 서버 데이터 레이아웃
- [docs/UI_SPEC.md](docs/UI_SPEC.md) — Modelon Impact 도움말 문서와 실제 스크린샷에서 추출한 UI 명세(레이아웃, 라벨, 색상 토큰, 상호작용)
- [docs/LIBRARY.md](docs/LIBRARY.md) — 포함된 라이브러리 클래스 목록과 MSL 대비 단순화 내역

## 제한 사항

- Modelica 서브셋: 배열, 함수, algorithm 섹션, `redeclare`, `inner/outer`, `stream`은 지원하지 않습니다(명확한 진단 메시지 출력).
- 솔버는 자체 구현입니다. `CVode`/`Radau5ODE` 라벨은 Impact UI와 맞추기 위한 것으로, 실제로는 각각 가변 스텝 BDF(1–2차)와 음함수 사다리꼴 적분기입니다.
- 3D 애니메이션, Steady-State 전용 솔버(PbS), 커스텀 함수(Python), Git/SVN 연동, 사용자 인증은 포함하지 않습니다.
- Modelon Impact의 로고·상표는 사용하지 않았습니다. 이 프로젝트는 Modelon과 무관합니다.

---

## English summary

A browser-based Modelica modeling & simulation platform that reproduces Modelon Impact's
four-area UI (Navigation bar, Workspace panel, Model canvas, Details panel), its
Model/Experiment/Results modes, Impact-style experiment settings and result browsing, and mirrors
its public REST API. It ships its own Modelica-subset compiler (parser, flattener, structural
index reduction) and DAE solver, plus a subset of the Modelica Standard Library with the original
icons. Run with `npm install && npm run dev`, then open <http://localhost:5173>.
