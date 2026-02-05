# -*- coding: utf-8 -*-
# d:\odoo\odoo\custom_addons\ODOO_AGILE\models\bpm_template.py
# Gestion des templates de workflow BPM prédéfinis
# Permet de créer rapidement des processus à partir de modèles

import json
import logging
from odoo import api, fields, models, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class BpmTemplate(models.Model):
    """Modèle représentant un template de processus BPM prédéfini"""
    _name = 'bpm.template'
    _description = 'Template de processus BPM'
    _order = 'sequence, name'

    name = fields.Char(string='Nom du template', required=True, translate=True)
    description = fields.Text(string='Description', translate=True)
    sequence = fields.Integer(string='Séquence', default=10)
    category = fields.Selection([
        ('sales', 'Ventes'),
        ('purchase', 'Achats'),
        ('hr', 'Ressources Humaines'),
        ('project', 'Projets'),
        ('inventory', 'Inventaire'),
        ('custom', 'Personnalisé'),
    ], string='Catégorie', required=True, default='custom')
    
    model_id = fields.Many2one(
        'ir.model',
        string='Modèle cible',
        required=True,
        ondelete='cascade',
        help='Modèle Odoo sur lequel ce template sera appliqué'
    )
    model_name = fields.Char(related='model_id.model', string='Nom du modèle', readonly=True)
    
    # Définition du template (JSON)
    template_data = fields.Text(
        string='Données du template',
        help='Structure JSON contenant les nœuds et transitions du template'
    )
    
    active = fields.Boolean(string='Actif', default=True)
    is_system = fields.Boolean(
        string='Template système',
        default=False,
        help='Les templates système ne peuvent pas être supprimés'
    )
    
    # Compteur d'utilisation
    usage_count = fields.Integer(
        string='Nombre d\'utilisations',
        compute='_compute_usage_count',
        store=False
    )
    
    def _compute_usage_count(self):
        """Compte le nombre de processus créés à partir de ce template"""
        for record in self:
            record.usage_count = self.env['bpm.process'].search_count([
                ('template_id', '=', record.id)
            ])
    
    def action_create_process_from_template(self):
        """Action pour créer un nouveau processus à partir de ce template"""
        self.ensure_one()
        
        return {
            'type': 'ir.actions.act_window',
            'name': _('Créer un processus depuis le template'),
            'res_model': 'bpm.template.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_template_id': self.id,
            }
        }
    
    def apply_template_to_process(self, process):
        """
        Applique ce template à un processus existant
        
        :param process: Enregistrement bpm.process
        """
        self.ensure_one()
        
        if not self.template_data:
            raise UserError(_('Ce template ne contient aucune donnée'))
        
        try:
            template_data = json.loads(self.template_data)
        except json.JSONDecodeError:
            raise UserError(_('Les données du template sont invalides'))
        
        # Supprime les nœuds et edges existants
        process.node_ids.unlink()
        process.edge_ids.unlink()
        
        # Crée les nœuds
        node_mapping = {}  # Mapping ancien_id -> nouveau_record
        for node_data in template_data.get('nodes', []):
            node_vals = {
                'process_id': process.id,
                'name': node_data.get('name', 'Nœud'),
                'node_type': node_data.get('type', 'task'),
                'position_x': node_data.get('x', 0),
                'position_y': node_data.get('y', 0),
                'node_id': node_data.get('id'),
            }
            node = self.env['bpm.node'].create(node_vals)
            node_mapping[node_data.get('id')] = node
        
        # Crée les edges
        for edge_data in template_data.get('edges', []):
            source_id = edge_data.get('source')
            target_id = edge_data.get('target')
            
            if source_id in node_mapping and target_id in node_mapping:
                edge_vals = {
                    'process_id': process.id,
                    'source_node_id': node_mapping[source_id].id,
                    'target_node_id': node_mapping[target_id].id,
                    'name': edge_data.get('name', ''),
                    'condition': edge_data.get('condition', ''),
                    'sequence': edge_data.get('sequence', 10),
                    'edge_id': edge_data.get('id'),
                }
                self.env['bpm.edge'].create(edge_vals)
        
        _logger.info('Template %s appliqué au processus %s', self.name, process.name)
        
        return True


class BpmProcess(models.Model):
    """Extension du modèle BpmProcess pour supporter les templates"""
    _inherit = 'bpm.process'
    
    template_id = fields.Many2one(
        'bpm.template',
        string='Créé depuis le template',
        readonly=True,
        help='Template utilisé pour créer ce processus'
    )
