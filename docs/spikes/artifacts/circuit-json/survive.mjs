import * as cj from 'circuit-json'
import * as kc from 'kicad-converter'
import { buildDivider } from './divider.mjs'

const base = buildDivider()

// Strategy A: extra fields. Does the converter MUTATE/strip the input array? (it JSON-clones internally)
const A = JSON.parse(JSON.stringify(base))
A.find(e=>e.type==='source_component').condenser_level = 2
const beforeA = JSON.stringify(A.find(e=>e.type==='source_component'))
kc.convertCircuitJsonToKiCadPcb(A)
const afterA = JSON.stringify(A.find(e=>e.type==='source_component'))
console.log('Strategy A: converter mutates input array?', beforeA !== afterA, '(false = your extensions stay on the array)')
console.log('  condenser_level still on element after convert:', A.find(e=>e.type==='source_component').condenser_level)

// Strategy B: sidecar. Converter ignores unknown type — does it survive & throw?
const B = JSON.parse(JSON.stringify(base))
B.push({ type:'condenser_component_meta', source_component_id:'sc_r1', level:2, semantic_ports:['vin','vout'] })
const sidecarBefore = B.filter(e=>e.type==='condenser_component_meta').length
kc.convertCircuitJsonToKiCadPcb(B)
const sidecarAfter = B.filter(e=>e.type==='condenser_component_meta').length
console.log('\nStrategy B: sidecar survives convert on input array?', sidecarAfter===sidecarBefore, '(count:', sidecarAfter+')')
console.log('  converter ignored unknown type without throwing: true (proven by prior run)')

// Can we still round-trip the FULL extended array (sidecar) and pull extensions back out by id?
const metaById = Object.fromEntries(B.filter(e=>e.type==='condenser_component_meta').map(m=>[m.source_component_id,m]))
console.log('  extension retrievable by id post-convert:', metaById['sc_r1']?.level === 2)

// Gerber export: is there anything in circuit-json or a separate pkg?
const gerberFns = Object.keys(cj).filter(k=>/gerber|fabric|export/i.test(k))
console.log('\ncircuit-json gerber/export exports:', gerberFns.length ? gerberFns.join(',') : '(none)')
