# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.

{
    'name': 'Gestion BPM avec Éditeur Graphique',
    'version': '19.0.1.0.0',
    'author': 'Ton Nom ou Société',
    'category': 'Business Process Management',
    'summary': 'Module de gestion de processus métiers avec éditeur graphique de workflow',
    'description': """
Module de Gestion BPM (Business Process Management)
===================================================

Ce module permet de définir des processus métiers dynamiques avec un éditeur graphique.

Fonctionnalités principales :
----------------------------
* Création de processus métiers personnalisés
* Éditeur graphique de workflow (glisser-déposer de nœuds)
* Types de nœuds : Start, Task, Gateway, End
* Conditions de transition entre les nœuds
* Suivi en temps réel des instances de processus
* Application de processus sur n'importe quel modèle Odoo
* Barre de progression visuelle pour suivre l'avancement

Architecture :
-------------
* bpm.process : Conteneur du processus
* bpm.node : Étapes du processus
* bpm.edge : Transitions entre les nœuds
* bpm.instance : Suivi des processus lancés
    """,
    'depends': ['base', 'web', 'mail', 'sale'],
    'data': [
        'security/ir.model.access.csv',
        'data/bpm_template_data.xml',
        'data/bpm_process_example.xml',
        'data/bpm_demo_data.xml',
        'views/bpm_views.xml',
        'views/bpm_menu.xml',
        'views/bpm_template_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'custom_bpm/static/src/css/bpm_graph_editor.css',
            'custom_bpm/static/src/js/bpm_graph_editor.js',
            'custom_bpm/static/src/xml/bpm_graph_editor.xml',
        ],
    },
    'installable': True,
    'application': True,
    'auto_install': False,
    'license': 'LGPL-3',
}

