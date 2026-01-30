# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.

import json
import logging
from odoo import api, fields, models, _
from odoo.exceptions import UserError, ValidationError
from odoo.tools import safe_eval

_logger = logging.getLogger(__name__)


class BpmProcess(models.Model):
    """Modèle représentant un processus BPM complet"""
    _name = 'bpm.process'
    _description = 'Processus BPM'
    _order = 'name'

    name = fields.Char(string='Nom du processus', required=True, translate=True)
    description = fields.Text(string='Description')
    model_id = fields.Many2one(
        'ir.model',
        string='Modèle cible',
        required=True,
        ondelete='cascade',
        help='Modèle Odoo sur lequel ce processus sera appliqué'
    )
    model_name = fields.Char(related='model_id.model', string='Nom du modèle', readonly=True, store=True)
    version = fields.Char(string='Version', default='1.0', required=True)
    active = fields.Boolean(string='Actif', default=True)
    
    # Définition JSON du workflow (coordonnées des nœuds et liens)
    json_definition = fields.Text(
        string='Définition JSON',
        help='Définition JSON du workflow générée par l\'éditeur graphique'
    )
    
    # Relations avec les nœuds et les instances
    node_ids = fields.One2many('bpm.node', 'process_id', string='Nœuds')
    edge_ids = fields.One2many('bpm.edge', 'process_id', string='Transitions')
    instance_ids = fields.One2many('bpm.instance', 'process_id', string='Instances')
    
    instance_count = fields.Integer(string='Nombre d\'instances', compute='_compute_instance_count')
    
    @api.depends('instance_ids')
    def _compute_instance_count(self):
        """Calcule le nombre d'instances pour chaque processus"""
        for record in self:
            record.instance_count = len(record.instance_ids)
    
    def action_view_instances(self):
        """Ouvre la vue des instances de ce processus"""
        self.ensure_one()
        return {
            'name': _('Instances du processus'),
            'type': 'ir.actions.act_window',
            'res_model': 'bpm.instance',
            'view_mode': 'tree,form',
            'domain': [('process_id', '=', self.id)],
            'context': {'default_process_id': self.id},
        }
    
    def action_launch_process(self):
        """Action pour lancer le processus (sera appelée depuis le modèle cible)"""
        self.ensure_one()
        return {
            'name': _('Lancer le processus'),
            'type': 'ir.actions.act_window',
            'res_model': 'bpm.instance',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_process_id': self.id,
            },
        }


class BpmNode(models.Model):
    """Modèle représentant un nœud (étape) dans le processus"""
    _name = 'bpm.node'
    _description = 'Nœud BPM'
    _order = 'sequence, id'

    name = fields.Char(string='Nom du nœud', required=True, translate=True)
    process_id = fields.Many2one('bpm.process', string='Processus', required=True, ondelete='cascade')
    node_type = fields.Selection([
        ('start', 'Début'),
        ('task', 'Tâche'),
        ('gateway', 'Passerelle (Décision)'),
        ('end', 'Fin'),
    ], string='Type de nœud', required=True, default='task')
    
    sequence = fields.Integer(string='Séquence', default=10)
    description = fields.Text(string='Description')
    
    # Coordonnées dans l'éditeur graphique
    position_x = fields.Float(string='Position X', default=0.0)
    position_y = fields.Float(string='Position Y', default=0.0)
    
    # Identifiant unique pour l'éditeur graphique
    node_id = fields.Char(string='ID du nœud', required=True, default=lambda self: self._generate_node_id())
    
    # Relations avec les transitions
    incoming_edge_ids = fields.One2many('bpm.edge', 'target_node_id', string='Transitions entrantes')
    outgoing_edge_ids = fields.One2many('bpm.edge', 'source_node_id', string='Transitions sortantes')
    
    # Actions à exécuter sur ce nœud (optionnel)
    action_code = fields.Text(
        string='Code Python',
        help='Code Python à exécuter lorsque le nœud est atteint'
    )
    
    # Assignation de tâche (pour les nœuds de type task)
    assigned_user_id = fields.Many2one('res.users', string='Utilisateur assigné')
    assigned_group_id = fields.Many2one('res.groups', string='Groupe assigné')
    
    @api.model
    def _generate_node_id(self):
        """Génère un ID unique pour le nœud"""
        import uuid
        return str(uuid.uuid4())[:8]
    
    _sql_constraints = [
        ('node_id_unique', 'unique(process_id, node_id)', 'L\'ID du nœud doit être unique dans un processus'),
    ]


class BpmEdge(models.Model):
    """Modèle représentant une transition (lien) entre deux nœuds"""
    _name = 'bpm.edge'
    _description = 'Transition BPM'
    _order = 'sequence, id'

    name = fields.Char(string='Nom de la transition', translate=True)
    process_id = fields.Many2one('bpm.process', string='Processus', required=True, ondelete='cascade')
    source_node_id = fields.Many2one('bpm.node', string='Nœud source', required=True, ondelete='cascade')
    target_node_id = fields.Many2one('bpm.node', string='Nœud cible', required=True, ondelete='cascade')
    
    sequence = fields.Integer(string='Séquence', default=10)
    
    # Condition de transition (code Python évalué)
    condition = fields.Text(
        string='Condition',
        help='Expression Python évaluée pour déterminer si cette transition peut être prise. '
             'Utilisez "record" pour référencer l\'enregistrement du modèle cible.'
    )
    
    # Identifiant unique pour l'éditeur graphique
    edge_id = fields.Char(string='ID de la transition', required=True, default=lambda self: self._generate_edge_id())
    
    @api.model
    def _generate_edge_id(self):
        """Génère un ID unique pour la transition"""
        import uuid
        return str(uuid.uuid4())[:8]
    
    @api.constrains('source_node_id', 'target_node_id')
    def _check_nodes_same_process(self):
        """Vérifie que les nœuds source et cible appartiennent au même processus"""
        for record in self:
            if record.source_node_id.process_id != record.target_node_id.process_id:
                raise ValidationError(_('Les nœuds source et cible doivent appartenir au même processus'))
    
    def evaluate_condition(self, record):
        """
        Évalue la condition de transition sur un enregistrement donné
        
        :param record: Enregistrement du modèle cible
        :return: True si la condition est satisfaite, False sinon
        """
        if not self.condition:
            return True  # Pas de condition = transition toujours disponible
        
        try:
            # Contexte d'évaluation sécurisé
            eval_context = {
                'record': record,
                'env': self.env,
                'datetime': __import__('datetime'),
                'dateutil': __import__('dateutil'),
            }
            result = safe_eval(self.condition, eval_context, mode='eval')
            return bool(result)
        except Exception as e:
            _logger.warning('Erreur lors de l\'évaluation de la condition de transition %s: %s', self.name, str(e))
            return False


class BpmInstance(models.Model):
    """Modèle représentant une instance d'exécution d'un processus"""
    _name = 'bpm.instance'
    _description = 'Instance BPM'
    _order = 'create_date desc'

    name = fields.Char(string='Nom de l\'instance', required=True, default=lambda self: _('Nouvelle instance'))
    process_id = fields.Many2one('bpm.process', string='Processus', required=True, ondelete='cascade')
    
    # Référence à l'enregistrement sur lequel le processus est appliqué
    res_model = fields.Char(string='Modèle', required=True)
    res_id = fields.Integer(string='ID de l\'enregistrement', required=True)
    res_record = fields.Reference(
        selection='_get_models',
        string='Enregistrement',
        compute='_compute_res_record',
        store=True
    )
    
    # État actuel du processus
    current_node_id = fields.Many2one('bpm.node', string='Nœud actuel')
    state = fields.Selection([
        ('draft', 'Brouillon'),
        ('running', 'En cours'),
        ('completed', 'Terminé'),
        ('cancelled', 'Annulé'),
    ], string='État', default='draft', required=True)
    
    # Historique des nœuds visités
    history_node_ids = fields.Many2many('bpm.node', 'bpm_instance_history_rel', 'instance_id', 'node_id', string='Historique')
    
    # Dates
    start_date = fields.Datetime(string='Date de début')
    end_date = fields.Datetime(string='Date de fin')
    
    # Utilisateur qui a lancé le processus
    user_id = fields.Many2one('res.users', string='Utilisateur', default=lambda self: self.env.user)
    
    # Progression (pourcentage)
    progress = fields.Float(string='Progression (%)', compute='_compute_progress', store=True)
    
    @api.model
    def _get_models(self):
        """Retourne la liste des modèles disponibles"""
        models = self.env['ir.model'].search([])
        return [(model.model, model.name) for model in models]
    
    @api.depends('res_model', 'res_id')
    def _compute_res_record(self):
        """Calcule la référence à l'enregistrement"""
        for record in self:
            if record.res_model and record.res_id:
                try:
                    model = self.env[record.res_model]
                    if model.exists([record.res_id]):
                        record.res_record = '%s,%s' % (record.res_model, record.res_id)
                    else:
                        record.res_record = False
                except Exception:
                    record.res_record = False
            else:
                record.res_record = False
    
    @api.depends('current_node_id', 'process_id', 'state')
    def _compute_progress(self):
        """Calcule la progression du processus"""
        for record in self:
            if record.state == 'completed':
                record.progress = 100.0
            elif record.state == 'cancelled':
                record.progress = 0.0
            elif record.state == 'draft':
                record.progress = 0.0
            elif record.process_id and record.current_node_id:
                # Calcul simple basé sur la position du nœud dans le processus
                # On pourrait améliorer cela avec un calcul plus sophistiqué
                total_nodes = len(record.process_id.node_ids)
                if total_nodes > 0:
                    # Approximation : on considère que chaque nœud représente une étape
                    visited = len(record.history_node_ids) + 1
                    record.progress = min(100.0, (visited / total_nodes) * 100.0)
                else:
                    record.progress = 0.0
            else:
                record.progress = 0.0
    
    def action_start(self):
        """Démarre l'instance du processus"""
        self.ensure_one()
        if self.state != 'draft':
            raise UserError(_('Le processus doit être en brouillon pour être démarré'))
        
        # Trouve le nœud de départ
        start_node = self.process_id.node_ids.filtered(lambda n: n.node_type == 'start')
        if not start_node:
            raise UserError(_('Aucun nœud de départ trouvé dans le processus'))
        
        if len(start_node) > 1:
            raise UserError(_('Plusieurs nœuds de départ trouvés. Il ne doit y en avoir qu\'un seul.'))
        
        self.write({
            'state': 'running',
            'current_node_id': start_node.id,
            'start_date': fields.Datetime.now(),
            'history_node_ids': [(4, start_node.id)],
        })
        
        # Exécute le code du nœud de départ si présent
        self._execute_node_code(start_node)
        
        return True
    
    def action_next_step(self):
        """
        Moteur d'exécution : passe à l'étape suivante du processus
        
        Cette méthode analyse le nœud actuel et déplace l'état vers le nœud suivant
        en fonction des conditions définies dans les edges.
        """
        self.ensure_one()
        if self.state != 'running':
            raise UserError(_('Le processus doit être en cours pour passer à l\'étape suivante'))
        
        if not self.current_node_id:
            raise UserError(_('Aucun nœud actuel défini'))
        
        current_node = self.current_node_id
        
        # Si on est sur un nœud de fin, on termine le processus
        if current_node.node_type == 'end':
            self.write({
                'state': 'completed',
                'end_date': fields.Datetime.now(),
                'progress': 100.0,
            })
            return True
        
        # Récupère l'enregistrement cible
        if not self.res_record:
            raise UserError(_('Aucun enregistrement cible défini'))
        
        record = self.res_record
        
        # Trouve les transitions sortantes du nœud actuel
        outgoing_edges = current_node.outgoing_edge_ids.sorted('sequence')
        
        if not outgoing_edges:
            # Pas de transition sortante = processus bloqué
            raise UserError(_('Aucune transition sortante disponible depuis le nœud "%s"') % current_node.name)
        
        # Évalue les conditions de chaque transition
        available_edges = []
        for edge in outgoing_edges:
            if edge.evaluate_condition(record):
                available_edges.append(edge)
        
        if not available_edges:
            raise UserError(_('Aucune condition de transition satisfaite depuis le nœud "%s"') % current_node.name)
        
        # Pour les passerelles (gateway), on prend la première transition valide
        # Pour les autres, on prend aussi la première (on pourrait améliorer avec une logique plus complexe)
        selected_edge = available_edges[0]
        next_node = selected_edge.target_node_id
        
        # Met à jour l'instance
        self.write({
            'current_node_id': next_node.id,
            'history_node_ids': [(4, next_node.id)],
        })
        
        # Exécute le code du nouveau nœud si présent
        self._execute_node_code(next_node)
        
        # Si le nouveau nœud est une fin, on termine le processus
        if next_node.node_type == 'end':
            self.write({
                'state': 'completed',
                'end_date': fields.Datetime.now(),
                'progress': 100.0,
            })
        
        return True
    
    def action_cancel(self):
        """Annule l'instance du processus"""
        self.ensure_one()
        if self.state in ('completed', 'cancelled'):
            raise UserError(_('Le processus est déjà terminé ou annulé'))
        
        self.write({
            'state': 'cancelled',
            'end_date': fields.Datetime.now(),
        })
        return True
    
    def _execute_node_code(self, node):
        """
        Exécute le code Python associé à un nœud
        
        :param node: Nœud BPM
        """
        if not node.action_code:
            return
        
        try:
            # Récupère l'enregistrement cible
            if not self.res_record:
                return
            
            record = self.res_record
            
            # Contexte d'exécution
            eval_context = {
                'record': record,
                'instance': self,
                'node': node,
                'env': self.env,
                'datetime': __import__('datetime'),
                'dateutil': __import__('dateutil'),
                'log': _logger,
            }
            
            # Exécute le code
            safe_eval(node.action_code, eval_context, mode='exec')
            
        except Exception as e:
            _logger.error('Erreur lors de l\'exécution du code du nœud %s: %s', node.name, str(e))
            raise UserError(_('Erreur lors de l\'exécution du code du nœud "%s": %s') % (node.name, str(e)))
    
    @api.model
    def create(self, vals):
        """Surcharge pour définir automatiquement res_model et res_id depuis res_record"""
        if 'res_record' in vals and vals['res_record']:
            res_record = vals['res_record']
            if isinstance(res_record, str) and ',' in res_record:
                res_model, res_id = res_record.split(',')
                vals['res_model'] = res_model
                vals['res_id'] = int(res_id)
        return super().create(vals)
    
    def write(self, vals):
        """Surcharge pour mettre à jour res_model et res_id depuis res_record"""
        if 'res_record' in vals and vals['res_record']:
            res_record = vals['res_record']
            if isinstance(res_record, str) and ',' in res_record:
                res_model, res_id = res_record.split(',')
                vals['res_model'] = res_model
                vals['res_id'] = int(res_id)
        return super().write(vals)

