// 전역 데이터 저장소
let appData = {};

function debounce(func, delay) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), delay);
  };
}

// --- 1. 초기화 및 데이터 로드 ---
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  
  // 페이지별 초기화
  if (document.getElementById('calculator-app')) initCalculator();
  if (document.getElementById('editor-app')) initEditor();
});

async function loadData() {
  let dataLoaded = false;
  try {
    const response = await fetch('./data.json');
    if (response.ok) {
      const jsonData = await response.json();
      appData = jsonData;
      console.log("서버 데이터 로드 완료:", appData);
      dataLoaded = true;
    }
  } catch (e) {
    console.warn("기본 데이터 로드 실패 (파일이 없거나 CORS 문제):", e);
  }

  // If on calculator page and data was not loaded from server, try local file input
  // Get reference to local test mode section
  const localTestModeSection = document.getElementById('localTestModeSection');

  if (dataLoaded && localTestModeSection) {
    localTestModeSection.style.display = 'none'; // Hide if data loaded successfully
  } else if (!dataLoaded && document.getElementById('calculator-app')) {
    // If data not loaded and on calculator page, show local test mode section (if it exists)
    if (localTestModeSection) {
        localTestModeSection.style.display = 'inline-block'; // Ensure it's visible
    }
    const calcFileInput = document.getElementById('calcFileInput');
    if (calcFileInput) {
      console.log("기본 data.json 파일을 로드하지 못했습니다. 아래 '로컬 테스트 모드'에서 data.json 파일을 직접 선택해주세요.");
      // Ensure the event listener is only added once
      if (!calcFileInput.dataset.listenerAdded) {
        calcFileInput.dataset.listenerAdded = 'true'; // Mark as added
        calcFileInput.addEventListener('change', function(e) {
          const file = e.target.files[0];
          if (file) {
            processJsonFile(file, (json) => {
              appData = json;
              console.log('로컬 data.json 파일 로드 완료!');
              // Re-initialize calculator after loading data
              initCalculator();
              // Clear input value to allow re-selecting the same file
              calcFileInput.value = ''; 
            });
          }
        });
      }
    }
  } else if (!dataLoaded && document.getElementById('editor-app')) {
    console.log("기본 data.json 파일을 로드하지 못했습니다. '기존 파일 불러오기'를 통해 data.json 파일을 직접 선택해주세요.");
  }
}

// Helper function to process a JSON file (used by both editor and calculator fallback)
function processJsonFile(file, callback) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const json = JSON.parse(e.target.result);
      if (json.materials && json.recipes && json.settings) { // Check for expected structure
        callback(json);
      } else {
        console.log('올바르지 않은 JSON 파일 형식입니다. (materials, recipes, settings 중 누락)');
      }
    } catch (err) {
      console.log('파일을 읽는 중 오류가 발생했습니다.');
      console.error(err);
    }
  };
  reader.readAsText(file);
}

// --- 2. 핵심 로직 (원가 및 효율 계산) ---

// Helper to find a recipe and its type
function findRecipe(itemName) {
  if (appData.recipes && appData.recipes[itemName]) {
    return { recipe: appData.recipes[itemName] };
  }
  return null;
}

function getTotalCostIncludingStamina(itemName, visited = new Set(), conservationLevel = 0) {
  // Check if it's a material
  if (appData.materials && appData.materials[itemName] !== undefined) {
    if (appData.materials[itemName] <= 0) {
      return { error: "material_price_missing", materialName: itemName };
    }
    return appData.materials[itemName];
  }

  // Check if it's a recipe
  const found = findRecipe(itemName);
  if (!found) {
    return { error: "item_not_found", itemName: itemName };
  }
  const { recipe } = found;

  // Detect circular dependencies
  if (visited.has(itemName)) {
    return { error: "circular_dependency", itemName: itemName };
  }
  visited.add(itemName);

  let cost = 0; // Initialize cost

  if (recipe.ingredients) {
    // Conservation applies to specific final products, not general processed goods or '방직'
    let reductionFactor = 1;
    if (recipe.category !== '가공품' && recipe.category !== '방직') {
      reductionFactor = (1 - (conservationLevel * 0.05));
    }
    for (const [ingName, count] of Object.entries(recipe.ingredients)) {
      const reducedCount = Math.round(count * reductionFactor);
      // Create a new Set for the recursive call to avoid issues with parallel branches
      const ingCost = getTotalCostIncludingStamina(ingName, new Set(visited), conservationLevel); 
      if (typeof ingCost === 'object' && ingCost.error) {
        return ingCost; // Propagate the error
      }
      cost += ingCost * reducedCount;
    }
  }
  // Get the effective stamina for this item, including all adjustments (e.g., intermediate, weaving recovery)
  // This value is then converted to NyanCoin and added to the cost.
  const effectiveStaminaForThisItem = getStamina(itemName, new Set(), conservationLevel);
  cost += effectiveStaminaForThisItem * (appData.settings.stamina_cost || 0);

  return cost;
}

function getMaterialCost(itemName, visited = new Set(), conservationLevel = 0) {
  // Check if it's a material
  if (appData.materials && appData.materials[itemName] !== undefined) {
    if (appData.materials[itemName] <= 0) {
      return { error: "material_price_missing", materialName: itemName };
    }
    return appData.materials[itemName];
  }

  // Check if it's a recipe
  const found = findRecipe(itemName);
  if (!found) {
    return { error: "item_not_found", itemName: itemName };
  }
  const { recipe } = found;

  // Detect circular dependencies
  if (visited.has(itemName)) {
    return { error: "circular_dependency", itemName: itemName };
  }
  visited.add(itemName);

  let cost = 0; // This is now material cost

  if (recipe.ingredients) {
    // Conservation applies to specific final products, not general processed goods or '방직'
    let reductionFactor = 1;
    if (recipe.category !== '가공품' && recipe.category !== '방직') {
      reductionFactor = (1 - (conservationLevel * 0.05));
    }
    for (const [ingName, count] of Object.entries(recipe.ingredients)) {
      const reducedCount = Math.round(count * reductionFactor);
      // Recursive call to getMaterialCost
      const ingCost = getMaterialCost(ingName, new Set(visited), conservationLevel); 
      if (typeof ingCost === 'object' && ingCost.error) {
        return ingCost;
      }
      cost += ingCost * reducedCount;
    }
  }
  // No stamina cost addition here, as this function is purely for material cost
  return cost;
}

function getStamina(itemName, visited = new Set(), conservationLevel = 0) {
  if (visited.has(itemName)) {
    return 0;
  }
  
  const found = findRecipe(itemName);
  if (!found) {
    return 0; // It's a material or not found, no stamina cost
  }
  
  const { recipe } = found;
  visited.add(itemName);

  const currentItemStamina = recipe.stamina || 0;
  let totalStamina = currentItemStamina;

  if (recipe.ingredients) {
    let reductionFactor = 1;
    // Conservation applies to specific final products, not general processed goods or '방직'
    if (recipe.category !== '가공품' && recipe.category !== '방직') {
      reductionFactor = (1 - (conservationLevel * 0.05));
    }
    for (const [ingName, count] of Object.entries(recipe.ingredients)) {
      const reducedCount = Math.round(count * reductionFactor);
      totalStamina += getStamina(ingName, new Set(visited), conservationLevel) * reducedCount;
    }
  }

  // If ignoreIntermediateStamina is ON and this item is an intermediate product,
  // subtract its own stamina contribution from the total, but keep the ingredient stamina.
  if (appData.settings.ignoreIntermediateStamina && (recipe.category === '가공품' || recipe.category === '방직')) {
    return totalStamina - currentItemStamina;
  }

  return totalStamina;
}

// 워라밸 레벨에 따른 스태미나 가치 계산 (매듭끈 체인 기준)
function calculateStaminaCost(wlbLevel) {
  if (wlbLevel <= 1) { // 순수 스태미나 이득이 없거나 음수인 경우
    return 99999; // 매우 비효율적임을 나타내는 큰 값
  }
  const totalBaseMaterialCost = 1000; // 25양모(500) + 25누에실(500)
  const totalCraftActions = 13;
  const netStaminaGainPerCraft = (wlbLevel - 1);
  const totalNetStaminaGain = totalCraftActions * netStaminaGainPerCraft;

  if (totalNetStaminaGain <= 0) { // 혹시 모를 분모 0 또는 음수 방지
      return 99999;
  }
  return (totalBaseMaterialCost / totalNetStaminaGain).toFixed(2); // 소수점 둘째자리까지 반환
}

function getReqCount(deliveryNumber) {
  if (deliveryNumber <= 1) return 1;
  if (deliveryNumber === 2) return 2;
  if (deliveryNumber >= 3 && deliveryNumber <= 10) return 3;
  if (deliveryNumber >= 11 && deliveryNumber <= 20) return 5;
  return 10; // 21회차 이상
}

function calcEfficiency(itemName, reward, deliveryMode = 'default') {
  const conservationLevel = (appData.settings && appData.settings.conservation_level !== undefined) ? appData.settings.conservation_level : 10;
  const materialCostResult = getMaterialCost(itemName, new Set(), conservationLevel);
  if (typeof materialCostResult === 'object' && materialCostResult.error) {
    return materialCostResult;
  }
  const consumedCoin = materialCostResult;
  const unitCostResult = getTotalCostIncludingStamina(itemName, new Set(), conservationLevel);
  
  if (typeof unitCostResult === 'object' && unitCostResult.error) {
    return unitCostResult;
  }
  const unitCost = unitCostResult;
  const unitStamina = getStamina(itemName, new Set(), conservationLevel);


  if (unitCost === 0) return { error: "generic_cost_error" };

  if (deliveryMode === 'default') {
    // 1. 마지노선 효율을 넘는 최대 납품 횟수(maxDeliveries)를 찾습니다.
    let maxDeliveries = 0;
    let keepChecking = true;
    let totalItemsForAvg = 0;
    while (keepChecking && maxDeliveries < 50) {
      const currentDeliveryNum = maxDeliveries + 1;
      
      totalItemsForAvg += getReqCount(currentDeliveryNum);

      const totalCostForAvg = unitCost * totalItemsForAvg;
      const totalProfitForAvg = reward * currentDeliveryNum;

      const averageEfficiency = totalCostForAvg > 0 ? totalProfitForAvg / totalCostForAvg : 0;

      if (averageEfficiency >= appData.settings.efficiency_limit) {
        maxDeliveries++;
      } else {
        keepChecking = false;
      }
    }


    if (maxDeliveries === 0) {
      const req = getReqCount(1);
      const eff = reward / (unitCost * req);
      return { 
        mode: deliveryMode,
        recommend: false, 
        msg: "납품 비추천 (효율 낮음)", 
        averageEfficiency: eff.toFixed(3), 
        unitCost: unitCost.toFixed(1),
        consumedCoin: (consumedCoin * req).toFixed(1), // Add consumedCoin here
        totalCost: (unitCost * req).toFixed(0),
        totalStamina: (unitStamina * req).toFixed(0),
        totalItems: req, // Add totalItems for consistency
        totalProfit: (reward * req) // Add totalProfit for consistency
      };
    }
    
    // 2. 공식 납품 횟수 단계 중 달성 가능한 가장 높은 단계를 찾습니다.
    const milestones = [25, 20, 10, 2, 1];
    const bestMilestone = milestones.find(m => m <= maxDeliveries);

    // 3. 찾은 단계(bestMilestone)에 맞춰 필요 아이템, 비용 등을 다시 계산합니다.
    let finalTotalItems = 0;
    let lastReq = 0;
    for (let i = 1; i <= bestMilestone; i++) {
      const req = getReqCount(i);
      finalTotalItems += req;
      lastReq = req;
    }

    const totalProfit = reward * bestMilestone;
    const totalCost = unitCost * finalTotalItems;
    const averageEfficiency = totalCost > 0 ? (totalProfit / totalCost) : 0;
    

    return {
      mode: 'default',
      recommend: true,
      round: bestMilestone,
      totalItems: finalTotalItems,
      totalProfit: totalProfit,
      averageEfficiency: averageEfficiency.toFixed(3),
      unitCost: unitCost.toFixed(1),
      consumedCoin: (consumedCoin * finalTotalItems).toFixed(1),
      totalCost: totalCost.toFixed(0),
      totalStamina: (unitStamina * finalTotalItems).toFixed(0)
    };

  } else { // '1회', '2회' 등 특정 횟수 시뮬레이션 모드
    const deliveryMap = { '1': 1, '2': 2, '3': 10, '5': 20, '10': 25 };
    const maxDeliveries = deliveryMap[deliveryMode];
    
    let currentTotal = 0;
    let lastReq = 0;

    if (maxDeliveries) {
      for (let i = 1; i <= maxDeliveries; i++) {
        const req = getReqCount(i);
        currentTotal += req;
        lastReq = req;
      }
    }
    
    if (maxDeliveries === 0) { // 혹시 모를 에러 방지
        return { recommend: false, msg: "계산 오류" };
    }

    const totalProfit = reward * maxDeliveries;
    const totalCost = unitCost * currentTotal;
    const averageEfficiency = totalCost > 0 ? (totalProfit / totalCost) : 0;

    return {
      mode: deliveryMode,
      recommend: true,
      round: maxDeliveries,
      totalItems: currentTotal,
      totalProfit: totalProfit,
      averageEfficiency: averageEfficiency.toFixed(3),
      unitCost: unitCost.toFixed(1),
      consumedCoin: (consumedCoin * currentTotal).toFixed(1), // Add consumedCoin here
      totalCost: totalCost.toFixed(0),
      totalStamina: (unitStamina * currentTotal).toFixed(0)
    };
  }
}


// --- 3. 계산기 페이지 로직 ---

let slotResults = {}; // 슬롯별 계산 결과를 저장하는 전역 객체

function updateClipboardTextarea() {
  const clipboardDataEl = document.getElementById('clipboard-data');
  if (!clipboardDataEl) return;

  const data = [];
  for (let i = 1; i <= 8; i++) {
    const nameInput = document.getElementById(`name-${i}`);
    const rewardInput = document.getElementById(`reward-${i}`);
    if (nameInput && rewardInput) {
      const name = nameInput.value.trim();
      const reward = rewardInput.value.trim();
      if (name && reward) {
        data.push(`${name} ${reward}`);
      }
    }
  }
  clipboardDataEl.value = data.join(', ');
}

function updateTotalSummary() {
  let totalCoin = 0;
  let totalStamina = 0;
  let totalNyan = 0;

  for (let i = 1; i <= 8; i++) {
    const res = slotResults[i];
    // 유효하고, 추천된 결과만 집계
    if (res && res.recommend) {
      totalCoin += parseFloat(res.consumedCoin) || 0; // Use consumedCoin for totalCoin
      totalStamina += parseFloat(res.totalStamina) || 0;
      totalNyan += parseFloat(res.totalProfit) || 0;
    }
  }

  const staminaValue = totalStamina * (appData.settings.stamina_cost || 0);
  const totalValue = totalCoin + staminaValue;
  const finalRatio = totalValue > 0 ? (totalNyan / totalValue).toFixed(3) : 0;

  // Check if elements exist before setting textContent to avoid errors
  const elCoin = document.getElementById('total-coin-cost');
  const elStamina = document.getElementById('total-stamina-cost');
  const elNyan = document.getElementById('total-nyan-gain');
  const elRatio = document.getElementById('final-exchange-ratio');

  if (elCoin) elCoin.textContent = totalCoin.toLocaleString();
  if (elStamina) elStamina.textContent = totalStamina.toLocaleString();
  if (elNyan) elNyan.textContent = totalNyan.toLocaleString();
  if (elRatio) elRatio.textContent = finalRatio;

  updateClipboardTextarea(); // Keep clipboard textarea in sync
}

function recalculateAllSlots() {
  for (let i = 1; i <= 8; i++) {
    const nameInput = document.getElementById(`name-${i}`);
    const rewardInput = document.getElementById(`reward-${i}`);
    const modeSelect = document.getElementById(`mode-${i}`);
    const resBox = document.getElementById(`result-${i}`);

    if (nameInput && rewardInput && resBox && modeSelect) {
      const name = nameInput.value.trim();
      const reward = parseFloat(rewardInput.value);
      const mode = modeSelect.value;
      const recipeInfo = findRecipe(name);

      if (name && !isNaN(reward) && reward > 0) {
        const res = calcEfficiency(name, reward, mode);
        slotResults[i] = res; // 결과 저장
        renderResult(resBox, res, recipeInfo);
      }
    }
  }
  updateTotalSummary(); // 모든 슬롯 재계산 후 요약 업데이트
}

function initCalculator() {
  if (!appData.settings) appData.settings = {}; // Ensure appData.settings exists from the start
  // --- Settings Inputs Handling ---
  const staminaCostInput = document.getElementById('staminaCost');
  const efficiencyLimitInput = document.getElementById('efficiencyLimit');
  const conservationLevelInput = document.getElementById('conservationLevel');
  const wlbLevelInput = document.getElementById('wlbLevel');
  const ignoreIntermediateStaminaInput = document.getElementById('ignoreIntermediateStamina');


  const updateSettings = () => {
    if (!appData.settings) appData.settings = {}; // Ensure appData.settings exists

    let staminaVal = parseFloat(staminaCostInput.value);
    let wlbVal = parseInt(wlbLevelInput.value, 10);

    // Prioritize manual staminaCostInput value if it's valid and wlbLevel is 'custom' or blank/invalid
    if (wlbLevelInput.value === 'custom' || isNaN(wlbVal)) {
        if (!isNaN(staminaVal) && staminaVal > 0) {
            appData.settings.stamina_cost = staminaVal;
            // Ensure wlbLevelInput stays 'custom' if stamina was manually set
            wlbLevelInput.value = 'custom';
        } else {
            // If custom stamina is invalid, attempt to calculate from WLB if possible
            if (!isNaN(wlbVal) && wlbVal >= 0 && wlbVal <= 10) {
                appData.settings.wlb_level = wlbVal;
                staminaVal = calculateStaminaCost(wlbVal);
                appData.settings.stamina_cost = staminaVal;
                staminaCostInput.value = staminaVal;
            } else {
                // Both are invalid, set a safe default
                appData.settings.stamina_cost = 99999;
                staminaCostInput.value = 99999; // Update UI
                wlbLevelInput.value = 'custom'; // Indicate custom if both are bad
            }
        }
        // When WLB is custom or invalid, set recovery to 0 as it's not a numeric level

    } else { // WLB level is a valid number
        appData.settings.wlb_level = wlbVal;
        staminaVal = calculateStaminaCost(wlbVal);
        appData.settings.stamina_cost = staminaVal;
        staminaCostInput.value = staminaVal; // Update staminaCost UI

    }

    // Update other settings
    appData.settings.efficiency_limit = parseFloat(efficiencyLimitInput.value) || 0.36;
    appData.settings.conservation_level = parseInt(conservationLevelInput.value, 10) || 0;
    appData.settings.ignoreIntermediateStamina = ignoreIntermediateStaminaInput.checked;

    recalculateAllSlots();
  };

  const debouncedUpdateSettings = debounce(updateSettings, 400);

  const updateStaminaCostDisplayFromWLB = () => {
    const wlbVal = parseInt(wlbLevelInput.value, 10);
    if (!isNaN(wlbVal) && wlbVal >= 0 && wlbVal <= 10) {
      const calculatedStamina = calculateStaminaCost(wlbVal);
      staminaCostInput.value = calculatedStamina;
    }
  };

  if (staminaCostInput && efficiencyLimitInput && conservationLevelInput && wlbLevelInput && ignoreIntermediateStaminaInput) {
    // Initial setup:
    // If WLB has a valid value, calculate stamina and set staminaCostInput.
    // Otherwise, assume custom stamina or a default.
    const initialWlbLevel = parseInt(wlbLevelInput.value, 10);
    if (!isNaN(initialWlbLevel) && initialWlbLevel >= 0 && initialWlbLevel <= 10) {
        appData.settings.wlb_level = initialWlbLevel;
        appData.settings.stamina_cost = calculateStaminaCost(initialWlbLevel);
        staminaCostInput.value = appData.settings.stamina_cost;
    } else {
        // Fallback: If initial WLB is not valid number, assume staminaCostInput value is custom
        appData.settings.stamina_cost = parseFloat(staminaCostInput.value) || 99999;
        wlbLevelInput.value = 'custom'; // Indicate custom
    }
    // Also set other initial settings
    appData.settings.efficiency_limit = parseFloat(efficiencyLimitInput.value) || 0.36;
    appData.settings.conservation_level = parseInt(conservationLevelInput.value, 10) || 0;
    appData.settings.ignoreIntermediateStamina = ignoreIntermediateStaminaInput.checked;


    
    // Initial recalculation after settings are applied

    staminaCostInput.addEventListener('input', () => {
      // When staminaCost is manually edited, set WLB to 'custom'
      if (wlbLevelInput.value !== 'custom') {
          wlbLevelInput.value = 'custom';
      }
      debouncedUpdateSettings();
    });
    
    wlbLevelInput.addEventListener('input', () => {
      // If WLB input is changed (and not 'custom'), calculate and update staminaCost
      if (wlbLevelInput.value !== 'custom') {
          updateStaminaCostDisplayFromWLB(); // Immediate UI update
      }
      debouncedUpdateSettings(); // Delayed full settings update and recalculation
    });

    efficiencyLimitInput.addEventListener('input', debouncedUpdateSettings);
    conservationLevelInput.addEventListener('input', debouncedUpdateSettings);
    ignoreIntermediateStaminaInput.addEventListener('change', updateSettings); // Direct call for immediate feedback

  }

  // Grid Creation ---
  const rows = [
    { count: 3, class: 'row-3' },
    { count: 3, class: 'row-3' }, // Changed to 3 slots for the second row
    { count: 3, class: 'row-3' }
  ];
  
  const container = document.getElementById('grid-container');
  // Clear any existing content to prevent duplication
  container.innerHTML = ''; 

  let slotIndex = 0; // For actual calculation slots (1-8)

  rows.forEach((rowInfo, rowIndex) => {
    const rowDiv = document.createElement('div');
    rowDiv.className = `row ${rowInfo.class}`;
    
    for (let i = 0; i < rowInfo.count; i++) {
      // Check if this is the 2nd row (rowIndex 1) and 3rd cell (i 2)
      if (rowIndex === 1 && i === 2) {
        // Insert the total-summary div here
        const summaryDivContent = `
            <div id="total-summary" class="card">
              <h3>종합 효율 요약</h3>
              <div class="summary-stats-container">
                <div class="summary-stat">
                  <span>총 소모 코인</span>
                  <b id="total-coin-cost">0</b>
                </div>
                <div class="summary-stat">
                  <span>총 소모 스태미나</span>
                  <b id="total-stamina-cost">0</b>
                </div>
                <div class="summary-stat">
                  <span>총 획득 냥코인</span>
                  <b id="total-nyan-gain" class="profit">0</b>
                </div>
                <div class="summary-stat">
                  <span>최종 교환비</span>
                  <b id="final-exchange-ratio">0</b>
                </div>
              </div>
            </div>
        `;
        const tempDiv = document.createElement('div'); // Create a temporary div to parse the HTML string
        tempDiv.innerHTML = summaryDivContent;
        // FIXED: Use firstElementChild to avoid picking up whitespace/text nodes
        rowDiv.appendChild(tempDiv.firstElementChild); 
      } else {
        slotIndex++; // Only increment for actual calculation slots
        const card = createSlot(slotIndex);
        rowDiv.appendChild(card);
      }
    }
    container.appendChild(rowDiv);
  });
  // Perform an initial recalculation after all elements are in the DOM
  recalculateAllSlots(); 

  const captureButton = document.getElementById('captureBtn');
  if (captureButton) {
    captureButton.addEventListener('click', () => {
      // Temporarily change button text
      captureButton.textContent = '...이미지 생성중...';
      captureButton.disabled = true;

      const target = document.getElementById('calculator-app');
      if (target) {
        html2canvas(target, {
          useCORS: true,
          scale: 2,
          backgroundColor: '#f8fafc',
          onclone: (clonedDoc) => {
            // Add padding to the cloned element for better spacing in the output image
            const clonedTarget = clonedDoc.getElementById('calculator-app');
            if (clonedTarget) {
              clonedTarget.style.padding = '20px';
            }
            
            // Hide the capture button in the cloned document
            const captureButton = clonedDoc.getElementById('captureBtn');
            if (captureButton && captureButton.parentElement) {
              captureButton.parentElement.style.display = 'none';
            }
            // Hide the clipboard section in the cloned document
            const clipboardSection = clonedDoc.getElementById('clipboard-section');
            if (clipboardSection) {
              clipboardSection.style.display = 'none';
            }
          }
        }).then(canvas => {
          const image = canvas.toDataURL('image/png');
          const link = document.createElement('a');
          link.href = image;
          
          // Create a filename with the current date
          const date = new Date();
          const dateString = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
          link.download = `nyancoin_table_${dateString}.png`;
          
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          // Restore button state
          captureButton.textContent = '📸 이미지로 저장';
          captureButton.disabled = false;

        }).catch(err => {
          console.error("Image capture failed:", err);
          console.log("오류: 이미지 생성에 실패했습니다. 콘솔을 확인해주세요.");
          
          // Restore button state
          captureButton.textContent = '📸 이미지로 저장';
          captureButton.disabled = false;
        });
      }
    });
  }

  // --- Clipboard Import/Export Logic ---
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const clipboardDataEl = document.getElementById('clipboard-data');

  if (exportBtn) {
    const originalBtnText = exportBtn.innerHTML;

    exportBtn.addEventListener('click', () => {
      const exportString = clipboardDataEl.value;
      navigator.clipboard.writeText(exportString).then(() => {
        exportBtn.innerHTML = '복사됨!';
        exportBtn.classList.add('copied');
        exportBtn.disabled = true;

        setTimeout(() => {
          exportBtn.innerHTML = originalBtnText;
          exportBtn.classList.remove('copied');
          exportBtn.disabled = false;
        }, 1000);

      }).catch(err => {
        console.log('클립보드 복사에 실패했습니다.');
        console.error('Clipboard copy failed:', err);
      });
    });
  }

  if (importBtn) {
    importBtn.addEventListener('click', () => {
      const importString = clipboardDataEl.value.trim();
      if (!importString) {
        console.log('붙여넣을 데이터가 없습니다.');
        return;
      }

      // Clear existing slots before importing
      for (let i = 1; i <= 8; i++) {
        const nameInput = document.getElementById(`name-${i}`);
        const rewardInput = document.getElementById(`reward-${i}`);
        if (nameInput && rewardInput) {
          nameInput.value = '';
          rewardInput.value = '';
        }
      }

      const parts = importString.split(',').map(s => s.trim());
      parts.forEach((part, index) => {
        if (index < 8) { // Only process up to 8 slots
          const slotIndex = index + 1;
          const lastSpaceIndex = part.lastIndexOf(' ');
          
          if (lastSpaceIndex > 0) {
            const name = part.substring(0, lastSpaceIndex).trim();
            const reward = part.substring(lastSpaceIndex + 1).trim();

            const nameInput = document.getElementById(`name-${slotIndex}`);
            const rewardInput = document.getElementById(`reward-${slotIndex}`);

            if (nameInput && rewardInput) {
              nameInput.value = name;
              rewardInput.value = reward;
            }
          }
        }
      });

      recalculateAllSlots();
      console.log('데이터를 붙여넣고 재계산했습니다.');
    });
  }
}

function createSlot(idx) {
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML = `
    <div class="input-group">
      <label>품목 ${idx}</label>
      <input type="text" list="itemList" id="name-${idx}" class="input" placeholder="품목 이름">
    </div>
    <div class="row" style="gap: 10px; align-items: flex-end;">
      <div class="input-group" style="flex: 2;">
        <label>보상 냥코인</label>
        <input type="number" id="reward-${idx}" class="input" placeholder="숫자 입력">
      </div>
      <div class="input-group" style="flex: 1;">
        <label>계산 방식</label>
        <select id="mode-${idx}" class="select-box">
          <option value="default">추천</option>
          <option value="1">1회</option>
          <option value="2">2회</option>
          <option value="3">10회</option>
          <option value="5">20회</option>
          <option value="10">25회</option>
        </select>
      </div>
    </div>
    <div class="result-box" id="result-${idx}"></div>
  `;

  const rewardInput = div.querySelector(`#reward-${idx}`);
  const nameInput = div.querySelector(`#name-${idx}`);
  const modeSelect = div.querySelector(`#mode-${idx}`);
  
  const doCalc = () => {
    const name = nameInput.value.trim();
    const recipeInfo = findRecipe(name);
    const reward = parseFloat(rewardInput.value);
    const mode = modeSelect.value;
    const resBox = div.querySelector(`#result-${idx}`);

    // Clear previous results when inputs change
    resBox.classList.remove('active');

    if (!name || isNaN(reward) || reward <= 0) {
      resBox.innerHTML = '';
      slotResults[idx] = null; // 저장된 결과 지우기
      updateTotalSummary(); // 요약 업데이트
      return;
    }

    const res = calcEfficiency(name, reward, mode);
    slotResults[idx] = res; // 결과 저장
    renderResult(resBox, res, recipeInfo);
    updateTotalSummary(); // 요약 업데이트
  };

  const debouncedDoCalc = debounce(doCalc, 300); // Debounce for 300ms

  rewardInput.addEventListener('input', debouncedDoCalc);
  nameInput.addEventListener('input', debouncedDoCalc);
  modeSelect.addEventListener('change', doCalc);
  
  // Keep keydown for Enter for immediate calculation if preferred
  rewardInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      doCalc();
      e.preventDefault(); // Prevent new line in some browsers
    }
  });
  
  nameInput.addEventListener('focus', updateDataList);

  return div;
}

function updateDataList() {
  const datalist = document.getElementById('itemList');
  datalist.innerHTML = '';
  if (!appData.recipes) return; // Guard against missing data

  const allItems = appData.recipes ? Object.keys(appData.recipes) : [];
  
  allItems.sort().forEach(item => {
    const opt = document.createElement('option');
    opt.value = item;
    datalist.appendChild(opt);
  });
}

function renderResult(el, res, recipeInfo) {
  el.className = 'result-box active';
  let categoryHtml = '';
  if (recipeInfo && recipeInfo.recipe && recipeInfo.recipe.category) {
    categoryHtml = `<div class="stat-row"><span>카테고리:</span> <span>${recipeInfo.recipe.category}</span></div>`;
  }

  if (res.error) {
    let errorMessage = "알 수 없는 오류 발생";
    switch (res.error) {
      case "item_not_found":
        errorMessage = `<b>"${res.itemName}"</b>(이)라는 품목을 찾을 수 없습니다. 철자를 확인하거나 데이터 관리자에서 추가해주세요.`;
        break;
      case "material_price_missing":
        errorMessage = `재료 <b>"${res.materialName}"</b>의 가격 정보가 없습니다. 데이터 관리자에서 가격을 설정해주세요.`;
        break;
      case "circular_dependency":
        errorMessage = `<b>"${res.itemName}"</b>에 순환 참조가 있습니다. 레시피를 확인해주세요.`;
        break;
      case "generic_cost_error":
        errorMessage = `원가 계산 중 오류가 발생했습니다.`;
        break;
      default:
        errorMessage = `오류: ${res.error}`;
    }
    el.innerHTML = `<span class="badge bad">오류 발생</span><p>${errorMessage}</p>`;
    return;
  }

  // Handle 'default' mode (recommendation)
  if (res.mode === 'default') {
    if (!res.recommend) {
      el.innerHTML = `
        <span class="badge bad">납품 비추천</span>
        ${categoryHtml}
        <div class="stat-row"><span>품목 1개당 단가:</span> <span>${res.unitCost}</span></div>
        <div class="stat-row"><span>필요 개수:</span> <b>${res.totalItems}개</b></div>
        <div class="stat-row"><span>예상 수입:</span> <b class="profit">${res.totalProfit.toLocaleString()}냥</b></div>
        <div class="stat-row"><span>소모 코인:</span> <span>${res.consumedCoin}</span></div>

        <div class="stat-row"><span>소모 스태미나:</span> <span>${res.totalStamina}</span></div>
        <div class="stat-row"><span>납품 효율:</span> <span>${res.averageEfficiency}</span></div>
      `;
      return;
    }

    let badgeClass = res.averageEfficiency >= 0.5 ? 'good' : 'warn'; // Use averageEfficiency for badge color logic
    el.innerHTML = `
      <span class="badge ${badgeClass}">${res.round}회 납품 추천</span>
      ${categoryHtml}
      <div class="stat-row"><span>품목 1개당 단가:</span> <span>${res.unitCost}</span></div>
      <div class="stat-row"><span>필요 개수:</span> <b>${res.totalItems}개</b></div>
      <div class="stat-row"><span>예상 수입:</span> <b class="profit">${res.totalProfit.toLocaleString()}냥</b></div>
      <div class="stat-row"><span>소모 코인:</span> <span>${res.consumedCoin}</span></div>
      <div class="stat-row"><span>소모 스태미나:</span> <span>${res.totalStamina}</span></div>
      <div class="stat-row"><span>납품 효율:</span> <span>${res.averageEfficiency}</span></div>
    `;
  } else { // Handle fixed delivery simulation
    const deliveryMap = { '1': '1회', '2': '2회', '3': '10회', '5': '20회', '10': '25회' };
    const badgeText = `${deliveryMap[res.mode]} 납품 시뮬레이션`;
    el.innerHTML = `
      <span class="badge info">${badgeText}</span>
      ${categoryHtml}
      <div class="stat-row"><span>품목 1개당 단가:</span> <span>${res.unitCost}</span></div>
      <div class="stat-row"><span>필요 개수:</span> <b>${res.totalItems}개</b></div>
      <div class="stat-row"><span>예상 수입:</span> <b class="profit">${res.totalProfit.toLocaleString()}냥</b></div>
      <div class="stat-row"><span>소모 코인:</span> <span>${res.consumedCoin}</span></div>
      <div class="stat-row"><span>소모 스태미나:</span> <span>${res.totalStamina}</span></div>
      <div class="stat-row"><span>납품 효율:</span> <span>${res.averageEfficiency}</span></div>
    `;
  }
}


// --- 4. 에디터 페이지 로직 ---
function initEditor() {
  renderJsonPreview();
  renderList('materials');
  renderList('recipes');

  // JSON 파일 불러오기 기능 추가
  document.getElementById('fileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    processJsonFile(file, (json) => {
      appData = json;
      renderList('materials');
      renderList('recipes');
      renderJsonPreview();
      console.log('데이터를 성공적으로 불러왔습니다!');
      // 파일 입력 초기화 (같은 파일 다시 선택 가능하도록)
      document.getElementById('fileInput').value = '';
    });
  });

  // JSON 다운로드
  document.getElementById('downloadBtn').addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "data.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  });

  // 재료 추가
  const matNameInput = document.getElementById('matName');
  const matPriceInput = document.getElementById('matPrice');
  const addMatButton = document.getElementById('addMatBtn');

  const tryAddMaterial = (e) => {
    if (e.key === 'Enter' && matNameInput.value && matPriceInput.value) {
      addMatButton.click();
    }
  };
  matNameInput.addEventListener('keydown', tryAddMaterial);
  matPriceInput.addEventListener('keydown', tryAddMaterial);

  addMatButton.addEventListener('click', () => {
    const name = matNameInput.value;
    const price = matPriceInput.value;
    if(name && price) {
      appData.materials[name] = parseFloat(price);
      renderList('materials');
      renderJsonPreview();
      clearInputs(['matName', 'matPrice']);
    }
  });
  
  // 레시피 추가
  const recNameInput = document.getElementById('recName');
  const recStaminaInput = document.getElementById('recStamina');
  const recIngsInput = document.getElementById('recIngs');
  const addRecipeButton = document.getElementById('addRecipeBtn');
  const recTypeRadios = document.querySelectorAll('input[name="recipeType"]');
  const recCategoryGroup = document.getElementById('recCategoryGroup');

  // 카테고리 드롭다운은 항상 표시

  const tryAddRecipe = (e) => {
    if (e.key === 'Enter' && recNameInput.value && recStaminaInput.value && recIngsInput.value) {
      addRecipeButton.click();
    }
  };
  recNameInput.addEventListener('keydown', tryAddRecipe);
  recStaminaInput.addEventListener('keydown', tryAddRecipe);
  recIngsInput.addEventListener('keydown', tryAddRecipe);

  addRecipeButton.addEventListener('click', () => {
    const name = recNameInput.value;
    const stamina = recStaminaInput.value;
    const ingredientsStr = recIngsInput.value;
    const category = document.getElementById('recCategory').value;
    
    if(name && stamina && ingredientsStr && category) {
      const ingObj = {};
      ingredientsStr.split(',').forEach(part => {
        part = part.trim();
        const lastSpaceIndex = part.lastIndexOf(' ');
        
        if (lastSpaceIndex !== -1) {
          const k = part.substring(0, lastSpaceIndex).trim();
          const v = part.substring(lastSpaceIndex + 1).trim();
          if(k && v) ingObj[k] = parseFloat(v);
        }
      });

      // Ensure the recipes object exists
      if (!appData.recipes) appData.recipes = {};

      appData.recipes[name] = {
        stamina: parseFloat(stamina),
        category: category, // Category is always added now
        ingredients: ingObj
      };
      renderList('recipes');
      renderJsonPreview();
      clearInputs(['recName', 'recStamina', 'recIngs']);
    }
  });
}

function renderList(type) {
  const listEl = document.getElementById(`${type}List`);
  listEl.innerHTML = '';
  const source = appData[type];

  if (!source) {
    console.warn(`Source data for '${type}' not found.`);
    return;
  }
  
  if (type === 'materials') {
    Object.keys(source).sort().forEach(key => {
      const div = document.createElement('div');
      div.className = 'list-item';
      div.innerHTML = `
        <div><b>${key}</b> <span style="font-size:12px; color:#666">${source[key]} 코인</span></div>
        <button class="btn-sm" onclick="deleteItem('${type}', '${key}')">삭제</button>
      `;
      listEl.appendChild(div);
    });
  } else if (type === 'recipes') {
    Object.keys(source).sort((a, b) => {
        // Sort by category first, then by name
        const itemA = source[a];
        const itemB = source[b];
        if (itemA.category === '가공품' && itemB.category !== '가공품') return -1;
        if (itemA.category !== '가공품' && itemB.category === '가공품') return 1;
        if (itemA.category && itemB.category && itemA.category !== itemB.category) {
            return itemA.category.localeCompare(itemB.category);
        }
        return a.localeCompare(b);
    }).forEach(key => {
      const item = source[key];
      const div = document.createElement('div');
      div.className = 'list-item';
      const categoryDisplay = item.category ? `(${item.category})` : '';
      const valStr = `⚡${item.stamina} ${categoryDisplay} / 재료: ${JSON.stringify(item.ingredients)}`;
      div.innerHTML = `
        <div><b>${key}</b> <span style="font-size:12px; color:#666">${valStr}</span></div>
        <button class="btn-sm" onclick="deleteItem('${type}', '${key}')">삭제</button>
      `;
      listEl.appendChild(div);
    });
  }
}

window.deleteItem = function(type, key) {
  if (type === 'recipes' && appData.recipes) {
    delete appData.recipes[key];
  } else if (appData[type]) {
    delete appData[type][key];
  }
  
  renderList(type);
  renderJsonPreview();
}

function renderJsonPreview() {
  document.getElementById('jsonPreview').textContent = JSON.stringify(appData, null, 2);
}

function clearInputs(ids) {
  ids.forEach(id => document.getElementById(id).value = '');
}