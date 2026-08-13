#!/usr/bin/env python3
"""
PSY4 Vertical Validation — Blind Listening Analysis

Reads the completed rating-sheet.csv and key.json.
Computes:
  - H5 (evaluator/perception agreement): pairwise agreement between human ranking and DSP ranking
  - H6 human component: does listener rate E >= 4 "commercial" for >= 2/3 compositions?

Run AFTER the listener has completed the rating sheet.
"""

import json
import os
import csv
from itertools import combinations
from pathlib import Path

LISTENING_DIR = '/home/z/my-project/validation/listening'
RESULTS_DIR = '/home/z/my-project/validation/results'
METRICS_PATH = os.path.join(RESULTS_DIR, 'metrics.json')

VARIANTS = ['A', 'B', 'C', 'D', 'E']
UNITS = [(c, s) for c in ['comp-1', 'comp-2', 'comp-3'] for s in [1, 2, 3]]


def load_ratings():
    ratings = {}
    with open(os.path.join(LISTENING_DIR, 'rating-sheet.csv')) as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not row['filename']:
                continue
            h = row['filename'].replace('.wav', '')
            ratings[h] = {
                'kick_quality': int(row['kick_quality']) if row['kick_quality'] else None,
                'bass_quality': int(row['bass_quality']) if row['bass_quality'] else None,
                'lead_quality': int(row['lead_quality']) if row['lead_quality'] else None,
                'mix_quality': int(row['mix_quality']) if row['mix_quality'] else None,
                'commercial': int(row['commercial']) if row['commercial'] else None,
            }
    return ratings


def load_key():
    with open(os.path.join(LISTENING_DIR, 'key.json')) as f:
        return json.load(f)


def load_metrics():
    with open(METRICS_PATH) as f:
        return json.load(f)


def compute_h5(ratings, key, metrics):
    """Pairwise agreement between human ranking and DSP ranking."""
    per_unit_agreements = []
    for comp, seed in UNITS:
        # Get the 5 variants for this unit
        unit_renders = {}
        for h, info in key.items():
            if info['comp'] == comp and info['seed'] == seed:
                unit_renders[info['variant']] = h

        if len(unit_renders) < 5:
            continue

        # DSP ranking: by aggregate
        dsp_scores = {v: metrics[f'{comp}-seed{seed}-{v}']['aggregate'] for v in VARIANTS}
        # Human ranking: by 'commercial' rating
        human_scores = {v: ratings.get(unit_renders[v], {}).get('commercial', 0) or 0 for v in VARIANTS}

        # Pairwise comparison
        pairs = list(combinations(VARIANTS, 2))
        agreeing = 0
        total = 0
        for v1, v2 in pairs:
            dsp_pref = 1 if dsp_scores[v1] > dsp_scores[v2] else (0 if dsp_scores[v1] < dsp_scores[v2] else None)
            human_pref = 1 if human_scores[v1] > human_scores[v2] else (0 if human_scores[v1] < human_scores[v2] else None)
            if dsp_pref is not None and human_pref is not None:
                total += 1
                if dsp_pref == human_pref:
                    agreeing += 1
        agreement = agreeing / total if total > 0 else 0
        per_unit_agreements.append({'unit': f'{comp}-seed{seed}', 'agreement': agreement, 'agreeing': agreeing, 'total': total})

    mean_agreement = sum(u['agreement'] for u in per_unit_agreements) / len(per_unit_agreements) if per_unit_agreements else 0
    units_above_60 = sum(1 for u in per_unit_agreements if u['agreement'] >= 0.60)

    passes = mean_agreement >= 0.70 and units_above_60 >= 7

    return {
        'name': 'evaluator/perception agreement',
        'mean_agreement': mean_agreement,
        'units_above_60_pct': units_above_60,
        'required_mean': 0.70,
        'required_units': 7,
        'passes': passes,
        'per_unit': per_unit_agreements,
    }


def compute_h6_human(ratings, key):
    """H6 human component: listener rates E >= 4 'commercial' for >= 2/3 compositions."""
    comp_e_ratings = {}
    for comp in ['comp-1', 'comp-2', 'comp-3']:
        # Average E rating across 3 seeds for this composition
        e_ratings = []
        for h, info in key.items():
            if info['comp'] == comp and info['variant'] == 'E':
                r = ratings.get(h, {}).get('commercial')
                if r is not None:
                    e_ratings.append(r)
        if e_ratings:
            comp_e_ratings[comp] = sum(e_ratings) / len(e_ratings)

    compositions_passing = sum(1 for comp, r in comp_e_ratings.items() if r >= 4)
    passes = compositions_passing >= 2

    return {
        'name': 'H6 human component',
        'e_commercial_ratings': comp_e_ratings,
        'compositions_passing': compositions_passing,
        'required': 2,
        'passes': passes,
    }


def main():
    if not os.path.exists(METRICS_PATH):
        print(f'ERROR: {METRICS_PATH} not found. Run critic.py first.')
        return

    ratings = load_ratings()
    key = load_key()
    metrics = load_metrics()

    completed = sum(1 for r in ratings.values() if r.get('commercial') is not None)
    print(f'Ratings loaded: {completed}/45 completed')

    if completed < 45:
        print(f'WARNING: only {completed}/45 renders rated. Results will be partial.')

    h5 = compute_h5(ratings, key, metrics)
    h6_human = compute_h6_human(ratings, key)

    # Load existing hypotheses and update H5 + H6
    hyp_path = os.path.join(RESULTS_DIR, 'hypotheses.json')
    with open(hyp_path) as f:
        hypotheses = json.load(f)

    hypotheses['H5'] = {
        'name': h5['name'],
        'mean_agreement': h5['mean_agreement'],
        'units_above_60_pct': h5['units_above_60_pct'],
        'rule': 'mean per-unit pairwise agreement >=70% AND >=7/9 units >=60%',
        'passes': h5['passes'],
        'summary': f'mean={h5["mean_agreement"]:.2%}, units>=60%={h5["units_above_60_pct"]}/9',
        'per_unit': h5['per_unit'],
    }

    # Update H6 with human component
    h6 = hypotheses['H6']
    h6['human_passes'] = h6_human['passes']
    h6['human_details'] = h6_human
    # H6 passes only if both aggregate and human pass
    h6['passes'] = h6.get('aggregate_passes', False) and h6_human['passes']
    h6['summary'] = f'{h6["passing_units"]}/9 units pass aggregate; human: {h6_human["compositions_passing"]}/3 compositions pass'

    with open(hyp_path, 'w') as f:
        json.dump(hypotheses, f, indent=2)

    print(f'\nH5 (evaluator/perception agreement): {"PASS" if h5["passes"] else "FAIL"}')
    print(f'  Mean agreement: {h5["mean_agreement"]:.2%} (required: >=70%)')
    print(f'  Units >=60%: {h5["units_above_60_pct"]}/9 (required: >=7)')

    print(f'\nH6 human component: {"PASS" if h6_human["passes"] else "FAIL"}')
    print(f'  E commercial ratings per composition:')
    for comp, r in h6_human['e_commercial_ratings'].items():
        print(f'    {comp}: {r:.1f}')
    print(f'  Compositions passing (>=4): {h6_human["compositions_passing"]}/3 (required: >=2)')

    print(f'\nUpdated hypotheses saved to {hyp_path}')


if __name__ == '__main__':
    main()
