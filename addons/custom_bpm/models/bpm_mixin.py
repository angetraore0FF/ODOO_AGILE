# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.

from odoo import api, fields, models, _
from odoo.exceptions import UserError


class BpmMixin(models.AbstractModel):
    """
    Mixin à ajouter aux modèles pour permettre de lancer des processus BPM
    
    Pour utiliser ce mixin, ajoutez-le à votre modèle :
    
    class YourModel(models.Model):
        _name = 'your.model'
        _inherit = ['bpm.mixin']
    """
    _name = 'bpm.mixin'
    _description = 'Mixin BPM pour les modèles'

    # Relation avec les instances de processus
    bpm_instance_ids = fields.One2many(
        'bpm.instance',
        'res_id',
        string='Instances BPM',
        domain=lambda self: [('res_model', '=', self._name)]
    )
    
    bpm_instance_count = fields.Integer(
        string='Nombre d\'instances BPM',
        compute='_compute_bpm_instance_count'
    )
    
    active_bpm_instance_id = fields.Many2one(
        'bpm.instance',
        string='Instance BPM active',
        compute='_compute_active_bpm_instance',
        store=False
    )
    
    @api.depends('bpm_instance_ids', 'bpm_instance_ids.state')
    def _compute_bpm_instance_count(self):
        """Calcule le nombre d'instances BPM actives"""
        for record in self:
            record.bpm_instance_count = len(record.bpm_instance_ids.filtered(
                lambda i: i.state in ('draft', 'running')
            ))
    
    @api.depends('bpm_instance_ids', 'bpm_instance_ids.state')
    def _compute_active_bpm_instance(self):
        """Trouve l'instance BPM active (en cours ou brouillon)"""
        for record in self:
            active = record.bpm_instance_ids.filtered(
                lambda i: i.state in ('draft', 'running')
            )
            record.active_bpm_instance_id = active[0] if active else False
    
    def action_launch_bpm_process(self):
        """
        Action pour lancer un processus BPM sur cet enregistrement
        
        Retourne un wizard pour sélectionner le processus à lancer
        """
        self.ensure_one()
        
        # Vérifie s'il existe déjà une instance active
        if self.active_bpm_instance_id:
            raise UserError(_(
                'Une instance de processus est déjà active sur cet enregistrement. '
                'Veuillez la terminer ou l\'annuler avant d\'en lancer une nouvelle.'
            ))
        
        # Trouve les processus disponibles pour ce modèle
        processes = self.env['bpm.process'].search([
            ('model_id.model', '=', self._name),
            ('active', '=', True)
        ])
        
        if not processes:
            raise UserError(_(
                'Aucun processus BPM actif n\'est disponible pour le modèle "%s".'
            ) % self._name)
        
        # Si un seul processus, le lance directement
        if len(processes) == 1:
            return self._create_bpm_instance(processes[0])
        
        # Sinon, retourne une action pour sélectionner le processus
        return {
            'name': _('Sélectionner un processus'),
            'type': 'ir.actions.act_window',
            'res_model': 'bpm.process',
            'view_mode': 'tree,form',
            'domain': [('id', 'in', processes.ids)],
            'context': {
                'default_res_model': self._name,
                'default_res_id': self.id,
            },
            'target': 'new',
        }
    
    def _create_bpm_instance(self, process):
        """
        Crée une instance de processus pour cet enregistrement
        
        :param process: bpm.process
        :return: Action pour ouvrir l'instance
        """
        self.ensure_one()
        
        instance = self.env['bpm.instance'].create({
            'name': _('%s - %s') % (process.name, self.display_name),
            'process_id': process.id,
            'res_model': self._name,
            'res_id': self.id,
        })
        
        return {
            'name': _('Instance BPM'),
            'type': 'ir.actions.act_window',
            'res_model': 'bpm.instance',
            'res_id': instance.id,
            'view_mode': 'form',
            'target': 'current',
        }
    
    def action_view_bpm_instances(self):
        """Ouvre la vue des instances BPM de cet enregistrement"""
        self.ensure_one()
        return {
            'name': _('Instances BPM'),
            'type': 'ir.actions.act_window',
            'res_model': 'bpm.instance',
            'view_mode': 'tree,form',
            'domain': [
                ('res_model', '=', self._name),
                ('res_id', '=', self.id)
            ],
            'context': {
                'default_res_model': self._name,
                'default_res_id': self.id,
            },
        }

