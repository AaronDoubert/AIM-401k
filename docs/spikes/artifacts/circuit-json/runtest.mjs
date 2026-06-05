import * as cj from 'circuit-json'
import * as kc from 'kicad-converter'
import { buildDivider } from './divider.mjs'

// --- validate base circuit element by element via the union ---
function validateSoup(soup) {
  const errs = []
  for (const [i, el] of soup.entries()) {
    const r = cj.any_circuit_element.safeParse(el)
    if (!r.success) errs.push({ i, type: el.type, issue: r.error.issues[0]?.message })
  }
  return errs
}

const base = buildDivider()
console.log('=== BASE circuit validation ===')
const baseErrs = validateSoup(base)
console.log('base elements:', base.length, '| validation errors:', baseErrs.length)
if (baseErrs.length) console.log(JSON.stringify(baseErrs, null, 2))

// --- Strategy (a): extra fields ON existing elements ---
const stratA = JSON.parse(JSON.stringify(base))
for (const el of stratA) {
  if (el.type === 'source_component') {
    el.condenser_level = 2
    el.semantic_ports = ['vin','vout']
    el.obligations = ['must_connect_gnd']
    el.module_provenance = 'lib/divider@1.0'
  }
}

// --- Strategy (b): sidecar element types referencing by id ---
const stratB = JSON.parse(JSON.stringify(base))
for (const el of base.filter(e => e.type === 'source_component')) {
  stratB.push({
    type: 'condenser_component_meta',
    source_component_id: el.source_component_id,
    level: 2,
    semantic_ports: ['vin','vout'],
    interfaces: ['power'],
    obligations: ['must_connect_gnd'],
    module_provenance: 'lib/divider@1.0',
  })
}

console.log('\n=== Strategy A validation (extra fields) ===')
const aErrs = validateSoup(stratA)
console.log('errors:', aErrs.length, '(extra fields accepted by strip-mode zod)')
// confirm strip on parse
const parsedA = cj.any_circuit_element.parse(stratA.find(e=>e.type==='source_component'))
console.log('extra field survives .parse()?', parsedA.condenser_level !== undefined)

console.log('\n=== Strategy B validation (sidecar) ===')
const bErrs = validateSoup(stratB)
console.log('errors:', bErrs.length, '(sidecar elements REJECTED by union if validated)')
console.log('rejected types:', [...new Set(bErrs.map(e=>e.type))].join(','))

// --- ROUND TRIP: convert each strategy through kicad-converter ---
function roundTrip(label, soup) {
  console.log(`\n=== ROUND TRIP: ${label} ===`)
  let pcb
  try {
    pcb = kc.convertCircuitJsonToKiCadPcb(soup)
  } catch (e) {
    console.log('  convertCircuitJsonToKiCadPcb THREW:', e.message)
    return
  }
  const footprints = pcb.footprints || []
  console.log('  -> KiCad PCB ok. footprints:', footprints.length, '| segments:', (pcb.segments||[]).length)
  // serialize to s-expr
  let sexpr
  try { sexpr = kc.convertKiCadPcbToSExprString(pcb); console.log('  -> s-expr bytes:', sexpr.length) }
  catch(e){ console.log('  s-expr THREW:', e.message) }
  // back to circuit json
  if (sexpr) {
    try {
      const back = kc.convertKiCadPcbToCircuitJson(kc.parseKiCadPcb(sexpr))
      const types = {}
      for (const el of back) types[el.type] = (types[el.type]||0)+1
      console.log('  -> back to circuit-json. element types:', JSON.stringify(types))
      // were condenser extensions present in the kicad output?
      const hasCondenser = sexpr.includes('condenser')
      console.log('  -> extensions leaked into KiCad output?', hasCondenser, '(false = cleanly stripped, expected)')
    } catch(e){ console.log('  back-convert THREW:', e.message) }
  }
}

roundTrip('Strategy A (extra fields)', stratA)
roundTrip('Strategy B (sidecar)', stratB)
roundTrip('BASE (no extensions)', base)
