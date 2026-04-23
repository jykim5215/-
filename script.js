const translations = {
  en: {
    pageTitle: "철봉.com | AI Pull-Up Bar Finder",
    brandNote: "Upload a pull-up bar photo. Let the model inspect it and place it into context.",
    heroEyebrow: "LLM-first website interface",
    heroTitle: "Analyze the bar from the image, then verify it on the map.",
    heroBody:
      "The main interface for 철봉.com is an AI analysis workspace. A user uploads a photo of a pull-up bar, and the model estimates the location, reads the environment around it, checks the bar condition, and suggests the best matching spot on the map.",
    statsMapped: "mapped pull-up bar spots",
    statsNearest: "nearest mapped spot after location sharing",
    uploadTitle: "Analyze a Pull-Up Bar Photo",
    uploadBody: "Upload one image and send it to the vision model for a structured inspection.",
    chipLocation: "Location clues",
    chipEnvironment: "Environment scan",
    chipCondition: "Condition check",
    dropzoneTitle: "Drop an image here or click to upload",
    dropzoneBody: "Best for outdoor photos with the bar and surrounding area visible.",
    analysisPromptLabel: "Extra instruction",
    analysisPromptPlaceholder:
      "Example: Focus on signs, nearby buildings, flooring, and whether the bar looks rusted or safe.",
    analyzeButton: "Analyze Image",
    locateButton: "Use My Location",
    previewTitle: "Image Preview",
    previewPlaceholder: "The uploaded pull-up bar image will appear here.",
    noFileSelected: "No file selected",
    reportTitle: "AI Report",
    reportBody: "The model returns a compact inspection of the scene and bar quality.",
    summaryStatusLabel: "Status",
    summaryWaitingTitle: "Waiting for an image",
    summaryWaitingBody: "Upload a pull-up bar photo to generate the first report.",
    suggestedTitle: "Suggested Map Match",
    suggestedBody: "When the model spots location clues, the nearest matching bar on the map appears here.",
    emptySuggested: "No suggested location yet.",
    mapTitle: "Reference Map",
    mapBody: "The map becomes a verification tool after the LLM analyzes the uploaded photo.",
    searchPlaceholder: "Search mapped bars by name, area, or address",
    nearbyTitle: "Nearby Bars",
    nearbyBody: "This list reorders itself after the browser shares the user's location.",
    labelArea: "Area",
    labelAddress: "Address",
    labelDistance: "Distance",
    labelWhyMatches: "Why it matches",
    fallbackMatchReason: "This is the best local match from the available map data.",
    labelSummary: "Summary",
    labelLikelyLocation: "Likely Location",
    labelBarCondition: "Bar Condition",
    labelEnvironment: "Environment",
    labelSafetyNotes: "Safety Notes",
    valueUnknown: "Unknown",
    valueNoConfidence: "No confidence level returned.",
    valueNoLocationReasoning: "No location reasoning returned.",
    valueNoConditionNotes: "No condition notes returned.",
    valueNoEnvironmentNotes: "No environment notes returned.",
    valueNoSafetyNotes: "No safety notes returned.",
    noSearchResults: "No locations match that search.",
    waitingTitle: "Waiting for an image",
    waitingBody: "Upload a pull-up bar photo to generate the first report.",
    statusNoImageUploaded: "No image uploaded yet.",
    statusImageFileOnly: "Please upload an image file.",
    statusFileTooLarge: "Please keep the file under 10 MB for the demo.",
    statusImageReady: "Image ready. Click Analyze Image to run the vision model.",
    statusUploadFirst: "Upload a pull-up bar image before analysis.",
    statusAnalyzing: "Analyzing the pull-up bar image with the model...",
    statusAnalysisComplete: "Analysis complete. The report and suggested map match are updated.",
    statusNoGeolocation: "This browser does not support geolocation.",
    statusLocationEnabled: "Location enabled. Nearby bars are now sorted by distance.",
    statusLocationBlocked: "Location access was blocked, so the website stays in browse mode.",
    previewAlt: "Uploaded pull-up bar preview",
    mapYouAreHere: "You are here",
    fileSizeFormat: "{name} - {sizeKb} KB",
  },
  ko: {
    pageTitle: "철봉.com | AI 철봉 찾기",
    brandNote: "철봉 사진을 올리면 모델이 장면을 분석하고 맥락까지 정리해 줍니다.",
    heroEyebrow: "LLM 중심 웹 인터페이스",
    heroTitle: "사진으로 철봉을 분석하고, 지도에서 위치를 확인하세요.",
    heroBody:
      "철봉.com의 메인 인터페이스는 AI 분석 작업 공간입니다. 사용자가 철봉 사진을 업로드하면 모델이 위치를 추정하고, 주변 환경을 읽고, 철봉 상태를 점검한 뒤, 지도에서 가장 비슷한 장소를 추천합니다.",
    statsMapped: "지도에 등록된 철봉 위치",
    statsNearest: "위치 공유 후 가장 가까운 등록 장소",
    uploadTitle: "철봉 사진 분석",
    uploadBody: "이미지 한 장을 올리면 비전 모델이 구조화된 분석을 생성합니다.",
    chipLocation: "위치 단서",
    chipEnvironment: "주변 환경 분석",
    chipCondition: "상태 점검",
    dropzoneTitle: "이미지를 여기로 끌어오거나 클릭해서 업로드",
    dropzoneBody: "철봉과 주변 공간이 함께 보이는 야외 사진이 가장 좋습니다.",
    analysisPromptLabel: "추가 지시",
    analysisPromptPlaceholder:
      "예시: 표지판, 주변 건물, 바닥 재질, 녹이나 안전 상태를 중심으로 봐줘.",
    analyzeButton: "이미지 분석",
    locateButton: "내 위치 사용",
    previewTitle: "이미지 미리보기",
    previewPlaceholder: "업로드한 철봉 사진이 여기에 표시됩니다.",
    noFileSelected: "선택된 파일 없음",
    reportTitle: "AI 리포트",
    reportBody: "모델이 장면과 철봉 상태를 간결하게 요약해 줍니다.",
    summaryStatusLabel: "상태",
    summaryWaitingTitle: "이미지를 기다리는 중",
    summaryWaitingBody: "철봉 사진을 업로드하면 첫 리포트를 생성합니다.",
    suggestedTitle: "추천 지도 매치",
    suggestedBody: "모델이 위치 단서를 포착하면 지도에서 가장 가까운 후보를 여기에 보여줍니다.",
    emptySuggested: "아직 추천 위치가 없습니다.",
    mapTitle: "참고 지도",
    mapBody: "업로드한 사진을 LLM이 분석한 뒤, 지도는 위치 검증 도구로 사용됩니다.",
    searchPlaceholder: "이름, 지역, 주소로 등록된 철봉 검색",
    nearbyTitle: "주변 철봉",
    nearbyBody: "브라우저에서 위치를 공유하면 이 목록이 거리순으로 다시 정렬됩니다.",
    labelArea: "지역",
    labelAddress: "주소",
    labelDistance: "거리",
    labelWhyMatches: "추천 이유",
    fallbackMatchReason: "현재 지도 데이터 기준으로 가장 잘 맞는 후보입니다.",
    labelSummary: "요약",
    labelLikelyLocation: "추정 위치",
    labelBarCondition: "철봉 상태",
    labelEnvironment: "주변 환경",
    labelSafetyNotes: "안전 메모",
    valueUnknown: "알 수 없음",
    valueNoConfidence: "신뢰도 정보가 없습니다.",
    valueNoLocationReasoning: "위치 추정 설명이 없습니다.",
    valueNoConditionNotes: "상태 메모가 없습니다.",
    valueNoEnvironmentNotes: "환경 메모가 없습니다.",
    valueNoSafetyNotes: "안전 메모가 없습니다.",
    noSearchResults: "검색 조건에 맞는 장소가 없습니다.",
    waitingTitle: "이미지를 기다리는 중",
    waitingBody: "철봉 사진을 업로드하면 첫 리포트를 생성합니다.",
    statusNoImageUploaded: "아직 업로드된 이미지가 없습니다.",
    statusImageFileOnly: "이미지 파일만 업로드해 주세요.",
    statusFileTooLarge: "데모에서는 10MB 이하 파일만 업로드해 주세요.",
    statusImageReady: "이미지가 준비되었습니다. 이미지 분석 버튼을 눌러 모델을 실행하세요.",
    statusUploadFirst: "분석 전에 철봉 이미지를 먼저 업로드해 주세요.",
    statusAnalyzing: "모델이 철봉 이미지를 분석하고 있습니다...",
    statusAnalysisComplete: "분석이 완료되었습니다. 리포트와 추천 위치가 업데이트되었습니다.",
    statusNoGeolocation: "이 브라우저는 위치 기능을 지원하지 않습니다.",
    statusLocationEnabled: "위치가 활성화되었습니다. 주변 철봉이 거리순으로 정렬됩니다.",
    statusLocationBlocked: "위치 접근이 차단되어 탐색 모드로 유지됩니다.",
    previewAlt: "업로드한 철봉 이미지 미리보기",
    mapYouAreHere: "현재 위치",
    fileSizeFormat: "{name} - {sizeKb} KB",
  },
};

const pullUpBars = [
  {
    id: 1,
    name: { en: "Namsan Park Fitness Corner", ko: "남산공원 운동 철봉" },
    area: { en: "Yongsan-gu", ko: "용산구" },
    address: { en: "Near the Namsan walking trail", ko: "남산 산책로 근처" },
    notes: { en: "Good starter location near central Seoul.", ko: "서울 중심부에서 접근하기 좋은 시작 지점입니다." },
    lat: 37.5514,
    lng: 126.9883,
  },
  {
    id: 2,
    name: { en: "Banpo Hangang Park Workout Zone", ko: "반포한강공원 운동 구역" },
    area: { en: "Seocho-gu", ko: "서초구" },
    address: { en: "Banpo riverside exercise area", ko: "반포 강변 운동 구역" },
    notes: { en: "Popular sunset workout spot.", ko: "해질 무렵 운동하기 좋은 인기 장소입니다." },
    lat: 37.5097,
    lng: 126.9959,
  },
  {
    id: 3,
    name: { en: "Seoul Forest Calisthenics Spot", ko: "서울숲 칼리스데닉스 철봉" },
    area: { en: "Seongdong-gu", ko: "성동구" },
    address: { en: "Inside Seoul Forest public fitness space", ko: "서울숲 공공 운동 공간 내부" },
    notes: { en: "Great park option with room to train.", ko: "넓은 공원 안에서 여유롭게 운동하기 좋은 곳입니다." },
    lat: 37.5444,
    lng: 127.0373,
  },
  {
    id: 4,
    name: { en: "Ttukseom Hangang Park Bar Station", ko: "뚝섬한강공원 철봉 스팟" },
    area: { en: "Gwangjin-gu", ko: "광진구" },
    address: { en: "Ttukseom riverside sports zone", ko: "뚝섬 강변 스포츠 구역" },
    notes: { en: "Nice option for a run plus pull-up session.", ko: "러닝과 철봉 운동을 함께 하기 좋은 장소입니다." },
    lat: 37.5293,
    lng: 127.0722,
  },
  {
    id: 5,
    name: { en: "Olympic Park Outdoor Gym", ko: "올림픽공원 야외 운동장" },
    area: { en: "Songpa-gu", ko: "송파구" },
    address: { en: "Olympic Park fitness corner", ko: "올림픽공원 운동 코너" },
    notes: { en: "Large park with multiple public workout points.", ko: "여러 공공 운동 시설이 있는 넓은 공원입니다." },
    lat: 37.5207,
    lng: 127.122,
  },
  {
    id: 6,
    name: { en: "World Cup Park Training Point", ko: "월드컵공원 트레이닝 지점" },
    area: { en: "Mapo-gu", ko: "마포구" },
    address: { en: "World Cup Park outdoor gym area", ko: "월드컵공원 야외 운동 구역" },
    notes: { en: "Starter marker for the west side of Seoul.", ko: "서울 서쪽 지역을 위한 시작 마커입니다." },
    lat: 37.5683,
    lng: 126.8789,
  },
];

const state = {
  locale: getInitialLocale(),
  userLocation: null,
  filteredBars: [...pullUpBars],
  markers: [],
  selectedId: null,
  userMarker: null,
  uploadedFile: null,
  uploadedDataUrl: "",
  analysis: null,
  statusTone: "",
  statusKey: "statusNoImageUploaded",
  statusRaw: "",
};

const map = L.map("map", { zoomControl: false }).setView([37.5665, 126.978], 12);
L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

function getInitialLocale() {
  const savedLocale = localStorage.getItem("cheolbong-locale");
  if (savedLocale === "en" || savedLocale === "ko") {
    return savedLocale;
  }
  return navigator.language && navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

function t(key, replacements = {}) {
  const table = translations[state.locale] || translations.en;
  let text = table[key] || translations.en[key] || key;
  for (const [name, value] of Object.entries(replacements)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

function localizeText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    return value[state.locale] || value.en || value.ko || "";
  }
  return "";
}

function collectText(value) {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectText(item));
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => collectText(item));
  }
  return [];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

function formatDistance(distanceKm) {
  if (distanceKm == null) {
    return "--";
  }
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m`;
  }
  return `${distanceKm.toFixed(1)} km`;
}

function renderStaticTranslations() {
  document.documentElement.lang = state.locale;
  document.title = t("pageTitle");
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
  });
  document.getElementById("previewImage").alt = t("previewAlt");
}

function renderLanguageButtons() {
  document.querySelectorAll(".lang-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.lang === state.locale);
  });
}

function setStatusKey(key, tone = "") {
  state.statusKey = key;
  state.statusRaw = "";
  state.statusTone = tone;
  renderStatus();
}

function setStatusRaw(text, tone = "") {
  state.statusKey = "";
  state.statusRaw = text;
  state.statusTone = tone;
  renderStatus();
}

function renderStatus() {
  const status = document.getElementById("analysisStatus");
  status.textContent = state.statusRaw || t(state.statusKey || "statusNoImageUploaded");
  status.className = state.statusTone ? `status-text ${state.statusTone}` : "status-text";
}

function renderFileMeta() {
  const fileMeta = document.getElementById("fileMeta");
  if (!state.uploadedFile) {
    fileMeta.textContent = t("noFileSelected");
    return;
  }
  fileMeta.textContent = t("fileSizeFormat", {
    name: state.uploadedFile.name,
    sizeKb: Math.max(1, Math.round(state.uploadedFile.size / 1024)),
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
}

function updatePreview(file, dataUrl) {
  const image = document.getElementById("previewImage");
  const placeholder = document.getElementById("previewPlaceholder");
  image.src = dataUrl;
  image.style.display = "block";
  placeholder.style.display = "none";
  state.uploadedFile = file;
  renderFileMeta();
}

function barSearchText(bar) {
  return [
    ...collectText(bar.name),
    ...collectText(bar.area),
    ...collectText(bar.address),
    ...collectText(bar.notes),
  ]
    .join(" ")
    .toLowerCase();
}

function computeVisibleBars() {
  const query = document.getElementById("searchInput").value.trim().toLowerCase();
  state.filteredBars = pullUpBars
    .map((bar) => ({
      ...bar,
      distanceKm: state.userLocation
        ? haversineDistance(state.userLocation.lat, state.userLocation.lng, bar.lat, bar.lng)
        : null,
    }))
    .filter((bar) => !query || barSearchText(bar).includes(query))
    .sort((left, right) => {
      if (left.distanceKm == null && right.distanceKm == null) {
        return localizeText(left.name).localeCompare(localizeText(right.name), state.locale);
      }
      if (left.distanceKm == null) return 1;
      if (right.distanceKm == null) return -1;
      return left.distanceKm - right.distanceKm;
    });
}

function findSuggestedBar(analysis) {
  if (!analysis) {
    return null;
  }
  const haystack = [
    ...collectText(analysis.summary),
    ...collectText(analysis.possible_match_query),
    ...collectText(analysis.likely_location?.area_guess),
    ...collectText(analysis.likely_location?.location_clues),
  ]
    .join(" ")
    .toLowerCase();

  if (!haystack) {
    return null;
  }

  let bestBar = null;
  let bestScore = 0;
  for (const bar of pullUpBars) {
    let score = 0;
    for (const field of [bar.name, bar.area, bar.address]) {
      for (const variant of collectText(field)) {
        const normalized = variant.toLowerCase();
        if (haystack.includes(normalized)) {
          score += 4;
        }
        for (const token of haystack.split(/[^a-z0-9가-힣-]+/).filter(Boolean)) {
          if (token.length >= 2 && normalized.includes(token)) {
            score += 1;
          }
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestBar = bar;
    }
  }
  return bestScore > 0 ? bestBar : null;
}

function joinLocalizedList(items, fallbackKey) {
  if (!Array.isArray(items) || items.length === 0) {
    return t(fallbackKey);
  }
  return items.map((item) => localizeText(item)).filter(Boolean).join(" | ");
}

function renderSelectedBar(bar = null, analysis = null) {
  const detail = document.getElementById("selectedBar");
  const selectedBar =
    bar ||
    state.filteredBars.find((item) => item.id === state.selectedId) ||
    pullUpBars.find((item) => item.id === state.selectedId);

  if (!selectedBar) {
    detail.innerHTML = `<p class="empty-state">${escapeHtml(t("emptySuggested"))}</p>`;
    return;
  }

  detail.innerHTML = `
    <h4 class="detail-title">${escapeHtml(localizeText(selectedBar.name))}</h4>
    <p class="detail-line"><strong>${escapeHtml(t("labelArea"))}:</strong> ${escapeHtml(localizeText(selectedBar.area))}</p>
    <p class="detail-line"><strong>${escapeHtml(t("labelAddress"))}:</strong> ${escapeHtml(localizeText(selectedBar.address))}</p>
    <p class="detail-line"><strong>${escapeHtml(t("labelDistance"))}:</strong> ${escapeHtml(formatDistance(selectedBar.distanceKm))}</p>
    <p class="detail-line"><strong>${escapeHtml(t("labelWhyMatches"))}:</strong> ${escapeHtml(
      localizeText(analysis?.likely_location?.reasoning) || t("fallbackMatchReason")
    )}</p>
  `;
}

function renderAnalysis() {
  const container = document.getElementById("analysisSummary");

  if (!state.analysis) {
    container.innerHTML = `
      <article class="summary-card">
        <span class="summary-label">${escapeHtml(t("summaryStatusLabel"))}</span>
        <strong>${escapeHtml(t("summaryWaitingTitle"))}</strong>
        <p>${escapeHtml(t("summaryWaitingBody"))}</p>
      </article>
    `;
    renderSelectedBar(null, null);
    return;
  }

  const analysis = state.analysis;
  container.innerHTML = `
    <article class="summary-card">
      <span class="summary-label">${escapeHtml(t("labelSummary"))}</span>
      <strong>${escapeHtml(localizeText(analysis.summary))}</strong>
      <p>${escapeHtml(localizeText(analysis.confidence_label) || t("valueNoConfidence"))}</p>
    </article>
    <div class="summary-grid">
      <article class="summary-card">
        <span class="summary-label">${escapeHtml(t("labelLikelyLocation"))}</span>
        <strong>${escapeHtml(localizeText(analysis.likely_location?.area_guess) || t("valueUnknown"))}</strong>
        <p>${escapeHtml(localizeText(analysis.likely_location?.reasoning) || t("valueNoLocationReasoning"))}</p>
      </article>
      <article class="summary-card">
        <span class="summary-label">${escapeHtml(t("labelBarCondition"))}</span>
        <strong>${escapeHtml(localizeText(analysis.bar_condition?.rating) || t("valueUnknown"))}</strong>
        <p>${escapeHtml(localizeText(analysis.bar_condition?.notes) || t("valueNoConditionNotes"))}</p>
      </article>
    </div>
    <article class="summary-card">
      <span class="summary-label">${escapeHtml(t("labelEnvironment"))}</span>
      <p>${escapeHtml(joinLocalizedList(analysis.environment, "valueNoEnvironmentNotes"))}</p>
    </article>
    <article class="summary-card">
      <span class="summary-label">${escapeHtml(t("labelSafetyNotes"))}</span>
      <p>${escapeHtml(joinLocalizedList(analysis.safety_observations, "valueNoSafetyNotes"))}</p>
    </article>
  `;

  const suggestedBar = findSuggestedBar(analysis);
  if (suggestedBar) {
    state.selectedId = suggestedBar.id;
    renderSelectedBar(suggestedBar, analysis);
    map.flyTo([suggestedBar.lat, suggestedBar.lng], 14, { duration: 0.8 });
  } else {
    renderSelectedBar(null, analysis);
  }
}

function renderList() {
  const list = document.getElementById("barList");
  document.getElementById("stat-count").textContent = state.filteredBars.length;
  document.getElementById("stat-nearest").textContent = state.filteredBars[0]
    ? formatDistance(state.filteredBars[0].distanceKm)
    : "--";

  if (state.filteredBars.length === 0) {
    list.innerHTML = `<div class="card"><p class="meta">${escapeHtml(t("noSearchResults"))}</p></div>`;
    return;
  }

  list.innerHTML = state.filteredBars
    .map(
      (bar) => `
        <article class="card" data-bar-id="${bar.id}">
          <div class="card-header">
            <p class="card-title">${escapeHtml(localizeText(bar.name))}</p>
            <span class="pill">${escapeHtml(localizeText(bar.area))}</span>
          </div>
          <p class="meta">${escapeHtml(localizeText(bar.address))}</p>
          <p class="meta">${escapeHtml(localizeText(bar.notes))}</p>
          <p class="meta">${escapeHtml(t("labelDistance"))}: ${escapeHtml(formatDistance(bar.distanceKm))}</p>
        </article>
      `
    )
    .join("");

  list.querySelectorAll("[data-bar-id]").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedId = Number(card.dataset.barId);
      renderSelectedBar();
      const selected = pullUpBars.find((bar) => bar.id === state.selectedId);
      if (selected) {
        map.flyTo([selected.lat, selected.lng], 15, { duration: 0.6 });
      }
    });
  });
}

function renderMarkers() {
  state.markers.forEach((marker) => marker.remove());
  state.markers = [];

  state.filteredBars.forEach((bar) => {
    const marker = L.marker([bar.lat, bar.lng])
      .addTo(map)
      .bindPopup(`
        <strong>${escapeHtml(localizeText(bar.name))}</strong><br>
        ${escapeHtml(localizeText(bar.area))}<br>
        ${escapeHtml(localizeText(bar.address))}<br>
        ${escapeHtml(t("labelDistance"))}: ${escapeHtml(formatDistance(bar.distanceKm))}
      `);

    marker.on("click", () => {
      state.selectedId = bar.id;
      renderSelectedBar();
    });

    state.markers.push(marker);
  });

  const bounds = state.filteredBars.map((bar) => [bar.lat, bar.lng]);
  if (state.userLocation) {
    bounds.push([state.userLocation.lat, state.userLocation.lng]);
  }
  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
  }
}

function rerenderMapAndList() {
  computeVisibleBars();
  renderList();
  renderMarkers();
  renderSelectedBar();
}

async function handleFileSelection(file) {
  if (!file) {
    return;
  }
  if (!file.type.startsWith("image/")) {
    setStatusKey("statusImageFileOnly", "error");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    setStatusKey("statusFileTooLarge", "error");
    return;
  }

  const dataUrl = await fileToDataUrl(file);
  state.uploadedDataUrl = dataUrl;
  updatePreview(file, dataUrl);
  setStatusKey("statusImageReady", "success");
}

async function analyzeImage() {
  if (!state.uploadedDataUrl) {
    setStatusKey("statusUploadFirst", "error");
    return;
  }

  const analyzeButton = document.getElementById("analyzeButton");
  analyzeButton.disabled = true;
  setStatusKey("statusAnalyzing");

  try {
    const response = await fetch("/api/analyze-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageDataUrl: state.uploadedDataUrl,
        userPrompt: document.getElementById("analysisPrompt").value.trim(),
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "The analysis request failed.");
    }

    state.analysis = payload.analysis;
    renderAnalysis();
    setStatusKey("statusAnalysisComplete", "success");
  } catch (error) {
    setStatusRaw(error.message, "error");
  } finally {
    analyzeButton.disabled = false;
  }
}

function setLocale(locale) {
  if (locale !== "en" && locale !== "ko") {
    return;
  }
  state.locale = locale;
  localStorage.setItem("cheolbong-locale", locale);
  renderStaticTranslations();
  renderLanguageButtons();
  renderFileMeta();
  renderStatus();
  rerenderMapAndList();
  renderAnalysis();
  if (state.userMarker) {
    state.userMarker.bindPopup(t("mapYouAreHere"));
  }
}

const imageInput = document.getElementById("imageInput");
const dropzone = document.getElementById("dropzone");

imageInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (file) {
    await handleFileSelection(file);
  }
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("is-dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("is-dragover");
});

dropzone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-dragover");
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    imageInput.files = event.dataTransfer.files;
    await handleFileSelection(file);
  }
});

document.getElementById("analyzeButton").addEventListener("click", analyzeImage);
document.getElementById("searchInput").addEventListener("input", rerenderMapAndList);
document.querySelectorAll(".lang-button").forEach((button) => {
  button.addEventListener("click", () => setLocale(button.dataset.lang));
});

document.getElementById("locateButton").addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatusKey("statusNoGeolocation", "error");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.userLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      if (state.userMarker) {
        state.userMarker.remove();
      }

      state.userMarker = L.circleMarker([state.userLocation.lat, state.userLocation.lng], {
        radius: 10,
        weight: 3,
        color: "#1f6d53",
        fillColor: "#ef6d2f",
        fillOpacity: 0.9,
      })
        .addTo(map)
        .bindPopup(t("mapYouAreHere"));

      rerenderMapAndList();
      setStatusKey("statusLocationEnabled", "success");
    },
    () => {
      setStatusKey("statusLocationBlocked", "error");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

renderStaticTranslations();
renderLanguageButtons();
renderFileMeta();
renderStatus();
rerenderMapAndList();
renderAnalysis();
