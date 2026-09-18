#!/usr/bin/env python3
"""Normalize public planning sources; usage: python3 scripts/import-minigrid-candidates.py ZAMBIA.geojson KENYA-generators.geojson"""
import collections
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'village-simulator/public/data'
SOURCES = {
    'ZM': 'https://energydata.info/dataset/zambia-nep-base-case-mini-grid',
    'KE': 'https://energydata.info/dataset/kenya-potential-new-mini-grid-sites',
}

def build(zambia, kenya):
    features = []
    excluded = collections.Counter()
    for feature in zambia['features']:
        p = feature['properties']
        if p['Elec metho'] != 'Mini-grid':
            excluded['non_minigrid_or_conflicting_classification'] += 1
            continue
        if p['Urban/Rura'] != 'rural':
            excluded['urban'] += 1
            continue
        features.append(normalize('ZM', str(p['ID']), p['Village'], feature['geometry'], {
            'administrative_area': p['Area'],
            'source_classification': p['Elec metho'],
            'source_alternative_classification': p['Classifica'],
            'settlement_classification': 'rural',
            'name_status': 'source_site_label_not_verified_village_name',
            'evidence_date': '2022-11-30',
            'evidence_date_basis': 'dataset_metadata_updated; analysis_year_not_verified',
            'geometry_basis': 'source_planning_site_point',
            'screening_basis': 'NEP base-case Mini-grid classification and rural flag; explicit grid-extension and unknown methods excluded',
        }))
    for feature in kenya['features']:
        p = feature['properties']
        features.append(normalize('KE', p['mg_name'], p['mg_name'], feature['geometry'], {
            'administrative_area': p['county'],
            'subcounty': p['subcounty'],
            'source_classification': 'Potential new mini-grid project',
            'settlement_classification': 'not_independently_verified',
            'name_status': 'source_project_name',
            'evidence_date': '2017–2018',
            'evidence_date_basis': 'least_cost_analysis_period',
            'geometry_basis': 'point_on_surface_of_proposed_generator_polygon',
            'screening_basis': 'Published least-cost proposed mini-grid projects; not a grid-extension project layer',
        }))
    ids = [f['id'] for f in features]
    assert len(ids) == len(set(ids)), 'Duplicate project IDs'
    return {'type': 'FeatureCollection', 'name': 'africa_minigrid_candidates',
            'description': 'Historical modeled mini-grid candidates in Kenya and Zambia. Not current eligibility, a complete Africa inventory, or verified villages. Utility ownership is not excluded.',
            'features': features}, dict(excluded)

def normalize(country, source_id, name, geometry, extra):
    assert geometry['type'] == 'Point'
    lon, lat = geometry['coordinates'][:2]
    assert -180 <= lon <= 180 and -90 <= lat <= 90
    return {'type': 'Feature', 'id': country + ':' + source_id,
            'geometry': {'type': 'Point', 'coordinates': [round(lon, 7), round(lat, 7)]},
            'properties': {'name': name, 'country_code': country,
                'country': {'KE': 'Kenya', 'ZM': 'Zambia'}[country],
                'source_id': source_id, 'candidate_status': 'historical_modeled_candidate',
                'current_eligibility': 'unverified', 'current_grid_connection': 'unknown',
                'planned_grid_extension': 'requires_current_plan_check',
                'utility_ownership': 'unknown', 'source_url': SOURCES[country],
                'source_license': 'CC0-1.0', **extra}}

if __name__ == '__main__':
    paths = [Path(p) for p in sys.argv[1:]]
    if len(paths) != 2:
        sys.exit(__doc__)
    data, excluded = build(*(json.loads(p.read_text()) for p in paths))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'africa-minigrid-candidates.geojson').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    manifest = {'coverage': ['Kenya', 'Zambia'], 'source_license': 'CC0-1.0',
        'counts': dict(collections.Counter(f['properties']['country'] for f in data['features'])),
        'zambia_exclusions': excluded,
        'input_sha256': {country: hashlib.sha256(path.read_bytes()).hexdigest() for country, path in zip(['ZM', 'KE'], paths)},
        'sources': SOURCES}
    (OUT / 'africa-minigrid-candidates.manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest, indent=2))
