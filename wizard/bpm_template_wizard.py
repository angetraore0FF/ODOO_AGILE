# -*- coding: utf-8 -*-
# d:\odoo\odoo\custom_addons\ODOO_AGILE\wizard\bpm_template_wizard.py
# Assistant pour créer un processus depuis un template

from odoo import api, fields, models, _
from odoo.exceptions import UserError


class BpmTemplateWizard(models.TransientModel):
    """Assistant pour créer un processus BPM depuis un template"""
    _name = 'bpm.template.wizard'
    _description = 'Assistant de création de processus depuis template'

    template_id = fields.Many2one(
        'bpm.template',
        string='Template',
        required=True,
        help='Template à utiliser pour créer le processus'
    )
    
    process_name = fields.Char(
        string='Nom du processus',
        required=True,
        help='Nom du nouveau processus à créer'
    )
    
    process_description = fields.Text(
        string='Description',
        help='Description du processus'
    )
    
    model_id = fields.Many2one(
        'ir.model',
        string='Modèle cible',
        required=True,
        related='template_id.model_id',
        readonly=True
    )
    
    auto_start = fields.Boolean(
        string='Démarrage automatique',
        default=False,
        help='Démarrer automatiquement le processus lors de la création/modification'
    )
    
    trigger_on = fields.Selection([
        ('create', 'À la création'),
        ('write', 'À la modification'),
        ('both', 'Création et modification'),
    ], string='Déclencheur', default='create')
    
    def action_create_process(self):
        """Crée un nouveau processus depuis le template"""
        self.ensure_one()
        
        if not self.template_id:
            raise UserError(_('Veuillez sélectionner un template'))
        
        # Crée le processus
        process_vals = {
            'name': self.process_name,
            'description': self.process_description or self.template_id.description,
            'model_id': self.model_id.id,
            'template_id': self.template_id.id,
            'auto_start': self.auto_start,
            'trigger_on': self.trigger_on,
            'active': True,
        }
        
        process = self.env['bpm.process'].create(process_vals)
        
        # Applique le template
        self.template_id.apply_template_to_process(process)
        
        # Incrémente le compteur d'utilisation (optionnel, car compute)
        # On pourrait stocker ça si besoin
        
        return {
            'type': 'ir.actions.act_window',
            'name': _('Processus créé'),
            'res_model': 'bpm.process',
            'res_id': process.id,
            'view_mode': 'form',
            'target': 'current',
        }
