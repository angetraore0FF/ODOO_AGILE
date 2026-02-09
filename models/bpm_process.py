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
    
    # Déclenchement automatique
    auto_start = fields.Boolean(
        string='Démarrage automatique',
        default=False,
        help='Si activé, le processus démarre automatiquement lors de la création/modification de l\'enregistrement'
    )
    trigger_on = fields.Selection([
        ('create', 'À la création'),
        ('write', 'À la modification'),
        ('both', 'Création et modification'),
    ], string='Déclencheur', default='create',
        help='Moment où le processus doit être déclenché automatiquement')
    
    trigger_condition = fields.Text(
        string='Condition de déclenchement',
        help='Expression Python pour décider si le processus doit démarrer. '
             'Exemple: record.state == "draft" and record.amount_total > 1000'
    )
    
    # Définition JSON du workflow (coordonnées des nœuds et liens)
    json_definition = fields.Text(
        string='Définition JSON',
        help='Définition JSON du workflow générée par l\'éditeur graphique'
    )
    
    # Validation du workflow
    is_valid = fields.Boolean(
        string='Workflow valide',
        compute='_compute_is_valid',
        store=False
    )
    validation_errors = fields.Text(
        string='Erreurs de validation',
        compute='_compute_is_valid',
        store=False
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
    
    @api.depends('node_ids', 'edge_ids')
    def _compute_is_valid(self):
        """Valide la cohérence du workflow"""
        for record in self:
            errors = []
            
            # Vérifier qu'il y a au moins un nœud de départ
            start_nodes = record.node_ids.filtered(lambda n: n.node_type == 'start')
            if not start_nodes:
                errors.append('❌ Aucun nœud de départ trouvé')
            elif len(start_nodes) > 1:
                errors.append('❌ Plusieurs nœuds de départ trouvés (il ne doit y en avoir qu\'un seul)')
            
            # Vérifier qu'il y a au moins un nœud de fin
            end_nodes = record.node_ids.filtered(lambda n: n.node_type == 'end')
            if not end_nodes:
                errors.append('❌ Aucun nœud de fin trouvé')
            
            # Vérifier qu'il n'y a pas de nœuds orphelins (sans connexion)
            for node in record.node_ids:
                if node.node_type == 'start':
                    # Un nœud start doit avoir au moins une sortie
                    if not node.outgoing_edge_ids:
                        errors.append(f'❌ Le nœud de départ "{node.name}" n\'a pas de transition sortante')
                elif node.node_type == 'end':
                    # Un nœud end doit avoir au moins une entrée
                    if not node.incoming_edge_ids:
                        errors.append(f'❌ Le nœud de fin "{node.name}" n\'a pas de transition entrante')
                else:
                    # Les autres nœuds doivent avoir entrées ET sorties
                    if not node.incoming_edge_ids and not node.outgoing_edge_ids:
                        errors.append(f'❌ Le nœud "{node.name}" est orphelin (aucune connexion)')
                    elif not node.incoming_edge_ids:
                        errors.append(f'⚠️ Le nœud "{node.name}" n\'a pas de transition entrante')
                    elif not node.outgoing_edge_ids:
                        errors.append(f'⚠️ Le nœud "{node.name}" n\'a pas de transition sortante')
            
            # Vérifier qu'il existe un chemin de start à end
            if start_nodes and end_nodes:
                if not record._has_path_to_end(start_nodes[0], set()):
                    errors.append('❌ Aucun chemin trouvé du nœud de départ vers un nœud de fin')
            
            # Détecter les boucles infinies potentielles
            if record._has_infinite_loop():
                errors.append('⚠️ Boucle infinie potentielle détectée dans le workflow')
            
            record.is_valid = len(errors) == 0
            record.validation_errors = '\n'.join(errors) if errors else '✅ Le workflow est valide'
    
    def _has_path_to_end(self, node, visited):
        """Vérifie récursivement s'il existe un chemin vers un nœud de fin"""
        if node.id in visited:
            return False
        
        if node.node_type == 'end':
            return True
        
        visited.add(node.id)
        
        for edge in node.outgoing_edge_ids:
            if self._has_path_to_end(edge.target_node_id, visited.copy()):
                return True
        
        return False
    
    def _has_infinite_loop(self):
        """Détecte les boucles infinies (nœuds qui pointent vers eux-mêmes directement ou indirectement)"""
        for node in self.node_ids:
            if self._creates_loop(node, {node.id}, node):
                return True
        return False
    
    def _creates_loop(self, current_node, visited, original_node):
        """Vérifie récursivement si un nœud crée une boucle"""
        for edge in current_node.outgoing_edge_ids:
            next_node = edge.target_node_id
            
            # Si on revient au nœud original sans passer par un end, c'est une boucle
            if next_node.id == original_node.id and next_node.node_type != 'end':
                return True
            
            # Si on a déjà visité ce nœud, on arrête (pas de boucle infinie)
            if next_node.id in visited:
                continue
            
            visited.add(next_node.id)
            
            if self._creates_loop(next_node, visited.copy(), original_node):
                return True
        
        return False
    
    def action_validate_workflow(self):
        """Action manuelle pour valider le workflow"""
        self.ensure_one()
        self._compute_is_valid()
        
        if self.is_valid:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _('Validation réussie'),
                    'message': _('Le workflow est valide et peut être utilisé.'),
                    'type': 'success',
                    'sticky': False,
                }
            }
        else:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _('Erreurs de validation'),
                    'message': self.validation_errors,
                    'type': 'warning',
                    'sticky': True,
                }
            }
    
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
    
    def action_start_instance_manual(self):
        """Démarre manuellement une instance BPM - demande l'ID de l'enregistrement"""
        self.ensure_one()
        
        if not self.model_name:
            raise UserError(_('Le modèle cible n\'est pas défini pour ce processus.'))
        
        # Pour le moment, affiche un message demandant de créer un nouvel enregistrement
        # ou utilise le menu "Mes tâches en attente" pour valider les instances existantes
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Démarrage manuel'),
                'message': _('Pour tester: Créez un nouvel enregistrement %s, le processus démarrera automatiquement. Ensuite allez dans "Mes tâches en attente" pour valider.') % self.model_name,
                'type': 'info',
                'sticky': True,
            }
        }
    
    def action_launch_process(self):
        """Action pour lancer le processus (sera appelée depuis le modèle cible)"""
        self.ensure_one()
        return {
            'name': _('Lancer le processus'),
            'type': 'ir.actions.act_window',
            'res_model': 'bpm.instance',
        }
    
    @api.model
    def _register_hook(self):
        """
        Hook pour enregistrer les déclencheurs automatiques sur les modèles cibles
        Cette méthode est appelée après le chargement de tous les modules
        IMPORTANT: Toute l'opération s'exécute en mode SUPERUSER pour éviter les problèmes de droits
        """
        super()._register_hook()
        
        _logger.info('=== BPM _register_hook appelé ===')
        
        # IMPORTANT: On exécute tout en sudo() car _register_hook est appelé pendant l'init
        # et l'utilisateur peut ne pas avoir les droits sur ir.model
        sudo_self = self.sudo()
        
        # Récupère tous les processus actifs avec démarrage automatique
        processes = sudo_self.search([('active', '=', True), ('auto_start', '=', True)])
        
        _logger.info('Processus avec auto_start trouvés: %d', len(processes))
        for p in processes:
            _logger.info('  - %s (model: %s, trigger: %s)', p.name, p.model_name, p.trigger_on)
        
        for process in processes:
            if not process.model_name:
                _logger.warning('Processus %s sans model_name, ignoré', process.name)
                continue
            
            # Crée les hooks pour le modèle cible
            try:
                # Accès au modèle via l'environment (pas besoin de sudo ici)
                model = self.env[process.model_name]
            except KeyError:
                _logger.warning('Modèle %s introuvable pour le processus %s', process.model_name, process.name)
                continue
            
            _logger.info('Installation hooks pour %s sur modèle %s', process.name, process.model_name)
            
            # Récupère la classe du modèle
            model_class = type(model)
            
            # Ajoute la méthode helper pour déclencher le processus AVANT de patcher
            if not hasattr(model_class, '_trigger_bpm_process'):
                def _trigger_bpm_process(self, record, trigger_type):
                    """Déclenche les processus BPM configurés pour ce modèle"""
                    _logger.info('=== _trigger_bpm_process appelé pour %s #%d (type: %s) ===', record._name, record.id, trigger_type)
                    
                    # Utilise sudo() pour éviter les problèmes de permissions
                    Process = self.env['bpm.process'].sudo()
                    processes = Process.search([
                        ('model_name', '=', record._name),
                        ('active', '=', True),
                        ('auto_start', '=', True),
                        ('trigger_on', 'in', [trigger_type, 'both'])
                    ])
                    
                    _logger.info('Processus correspondants trouvés: %d', len(processes))
                    
                    for process in processes:
                        _logger.info('Évaluation processus: %s', process.name)
                        
                        # Vérifie la condition de déclenchement
                        if process.trigger_condition:
                            _logger.info('Condition à évaluer: %s', process.trigger_condition)
                            try:
                                eval_context = {
                                    'record': record,
                                    'env': self.env,
                                }
                                result = safe_eval(process.trigger_condition, eval_context, mode='eval')
                                _logger.info('Résultat condition: %s', result)
                                if not result:
                                    _logger.info('Condition non satisfaite, processus ignoré')
                                    continue
                            except Exception as e:
                                _logger.warning('Erreur condition déclenchement processus %s: %s', process.name, str(e))
                                continue
                        
                        # Crée l'instance du processus (avec sudo pour BPM mais record original)
                        instance = self.env['bpm.instance'].sudo().create({
                            'process_id': process.id,
                            'res_model': record._name,
                            'res_id': record.id,
                            'name': f'{process.name} - {record.display_name}',
                        })
                        _logger.info('✅ Instance BPM créée automatiquement: ID %d pour %s #%d', instance.id, record._name, record.id)
                
                model_class._trigger_bpm_process = _trigger_bpm_process
                _logger.info('Méthode _trigger_bpm_process ajoutée au modèle %s', process.model_name)
            
            # Hook pour la création
            if process.trigger_on in ('create', 'both'):
                # Vérifie si le hook n'est pas déjà installé
                if not hasattr(model_class.create, '_bpm_patched'):
                    # Garde une référence à la méthode VRAIMENT originale
                    original_create = model_class.create.__func__ if hasattr(model_class.create, '__func__') else model_class.create
                    
                    @api.model_create_multi
                    def create_with_bpm(self, vals_list):
                        # Appelle la méthode originale directement sur super()
                        records = original_create(self, vals_list)
                        # Lance le processus pour chaque enregistrement créé
                        for record in records:
                            self._trigger_bpm_process(record, 'create')
                        return records
                    
                    # Marque comme patché pour éviter double patch
                    create_with_bpm._bpm_patched = True
                    
                    # Remplace la méthode create
                    model_class.create = create_with_bpm
                    _logger.info('  - Hook create installé')
                else:
                    _logger.info('  - Hook create déjà installé, ignoré')
            
            # Hook pour la modification
            if process.trigger_on in ('write', 'both'):
                # Vérifie si le hook n'est pas déjà installé
                if not hasattr(model_class.write, '_bpm_patched'):
                    # Garde une référence à la méthode VRAIMENT originale
                    original_write = model_class.write.__func__ if hasattr(model_class.write, '__func__') else model_class.write
                    
                    def write_with_bpm(self, vals):
                        # Appelle la méthode originale
                        result = original_write(self, vals)
                        # Lance le processus pour chaque enregistrement modifié
                        for record in self:
                            record._trigger_bpm_process(record, 'write')
                        return result
                    
                    # Marque comme patché pour éviter double patch
                    write_with_bpm._bpm_patched = True
                    
                    # Remplace la méthode write
                    model_class.write = write_with_bpm
                    _logger.info('  - Hook write installé')
                else:
                    _logger.info('  - Hook write déjà installé, ignoré')
        
        return True
        return True


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
    
    # Type de fin (pour les nœuds de type 'end')
    end_type = fields.Selection([
        ('success', 'Succès'),
        ('failure', 'Échec'),
        ('cancelled', 'Annulé'),
    ], string='Type de fin',
        help='Définit le type de finalisation du processus')
    
    # Actions post-finalisation
    end_action = fields.Selection([
        ('none', 'Aucune'),
        ('archive', 'Archiver l\'enregistrement'),
        ('notify', 'Envoyer une notification'),
        ('both', 'Archiver et notifier'),
    ], string='Action de fin', default='none',
        help='Action à effectuer lorsque ce nœud de fin est atteint')
    
    sequence = fields.Integer(string='Séquence', default=10)
    description = fields.Text(string='Description')
    
    # Actions automatiques
    auto_action = fields.Selection([
        ('none', 'Aucune'),
        ('create_delivery', 'Créer bon de livraison (sale.order)'),
        ('create_invoice', 'Créer facture (sale.order)'),
        ('validate_delivery', 'Valider livraison (stock.picking)'),
        ('confirm_order', 'Confirmer commande (sale.order)'),
        ('custom_code', 'Code Python personnalisé'),
    ], string='Action automatique', default='none',
        help='Action exécutée automatiquement lorsque ce nœud est atteint')
    
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
    requires_validation = fields.Boolean(
        string='Nécessite validation manuelle',
        default=False,
        help='Si activé, le processus attend qu\'un utilisateur valide manuellement ce nœud'
    )
    assigned_user_id = fields.Many2one('res.users', string='Utilisateur assigné',
        help='Utilisateur qui doit valider cette tâche')
    assigned_group_id = fields.Many2one('res.groups', string='Groupe assigné',
        help='Groupe d\'utilisateurs pouvant valider cette tâche')
    
    # Notifications
    send_email = fields.Boolean(
        string='Envoyer un email',
        default=False,
        help='Envoyer un email automatiquement quand ce nœud est atteint'
    )
    email_template_id = fields.Many2one(
        'mail.template',
        string='Template d\'email',
        help='Template d\'email à utiliser. Si vide, un email simple sera envoyé.'
    )
    email_to = fields.Selection([
        ('assigned_user', 'Utilisateur assigné'),
        ('process_creator', 'Créateur du processus'),
        ('record_salesperson', 'Commercial (si applicable)'),
        ('custom', 'Email personnalisé'),
    ], string='Destinataire', default='assigned_user')
    email_to_custom = fields.Char(string='Email personnalisé')
    email_subject = fields.Char(string='Sujet de l\'email')
    email_body = fields.Html(string='Corps de l\'email')
    
    @api.model
    def _generate_node_id(self):
        """Génère un ID unique pour le nœud"""
        import uuid
        return str(uuid.uuid4())[:8]
    
    def execute_node(self, instance):
        """Exécute les actions de ce nœud"""
        self.ensure_one()
        _logger.info('🎯 Exécution du nœud %s pour instance #%d', self.name, instance.id)
        
        has_error = False
        error_messages = []
        
        # Exécute l'action automatique si définie
        if self.auto_action != 'none':
            try:
                self._execute_auto_action(instance)
            except Exception as e:
                error_msg = f'⚠️ Erreur action automatique: {str(e)}'
                _logger.warning(error_msg)
                error_messages.append(error_msg)
                has_error = True
        
        # Envoie un email si configuré
        if self.send_email:
            try:
                self._send_email_notification(instance)
            except Exception as e:
                error_msg = f'⚠️ Erreur envoi email: {str(e)}'
                _logger.warning(error_msg)
                error_messages.append(error_msg)
        
        # Log les erreurs si nécessaire
        if error_messages:
            try:
                current_log = instance.error_log or ''
                new_log = '\n'.join(error_messages)
                instance.sudo().write({
                    'error_log': f'{current_log}\n{new_log}' if current_log else new_log
                })
            except Exception as e:
                _logger.error('Impossible d\'écrire dans error_log: %s', str(e))
        
        # Si pas de validation requise, avance automatiquement
        if not self.requires_validation:
            instance.advance_to_next_node()
        else:
            _logger.info('⏸️ Nœud nécessite validation manuelle - en attente')
            # Envoyer une notification à l'utilisateur assigné
            try:
                self._send_validation_notification(instance)
            except Exception as e:
                _logger.warning('⚠️ Erreur envoi notification: %s', str(e))
    
    def _execute_auto_action(self, instance):
        """Exécute l'action automatique du nœud"""
        self.ensure_one()
        record = instance.get_record()
        
        if not record:
            raise UserError(_("L'enregistrement lié n'existe plus"))
        
        _logger.info('🤖 Exécution action automatique: %s', self.auto_action)
        
        if self.auto_action == 'create_invoice' and instance.res_model == 'sale.order':
            _logger.info('📄 Tentative de création de facture depuis commande %s', record.name)
            
            # Confirmer la commande si nécessaire
            if record.state in ('draft', 'sent'):
                record.action_confirm()
            
            # Vérifier qu'il y a quelque chose à facturer
            if not any(line.qty_to_invoice > 0 for line in record.order_line):
                _logger.warning('⚠️ Aucune ligne à facturer pour la commande %s - action ignorée', record.name)
                return
            
            # Créer la facture
            if hasattr(record, '_create_invoices'):
                invoice = record._create_invoices()
                if invoice:
                    _logger.info('✅ Facture créée: %s', invoice.mapped('name'))
                else:
                    _logger.warning('⚠️ Aucune facture créée pour la commande %s', record.name)
                
        elif self.auto_action == 'create_delivery' and instance.res_model == 'sale.order':
            if hasattr(record, 'action_confirm'):
                record.action_confirm()
                _logger.info('✅ Bon de livraison créé')
                
        elif self.auto_action == 'confirm_order' and instance.res_model == 'sale.order':
            if hasattr(record, 'action_confirm'):
                record.action_confirm()
                _logger.info('✅ Commande confirmée')
                
        elif self.auto_action == 'validate_delivery' and instance.res_model == 'stock.picking':
            if hasattr(record, 'button_validate'):
                record.button_validate()
                _logger.info('✅ Livraison validée')
                
        elif self.auto_action == 'custom_code' and self.action_code:
            # Exécution de code Python personnalisé
            eval_context = {
                'record': record,
                'env': self.env,
                'instance': instance,
                'datetime': __import__('datetime'),
                '_logger': _logger,
            }
            safe_eval(self.action_code, eval_context, mode='exec', nocopy=True)
            _logger.info('✅ Code personnalisé exécuté')
    
    def _send_email_notification(self, instance):
        """Envoie une notification email"""
        self.ensure_one()
        _logger.info('📧 Envoi email pour nœud %s', self.name)
        
        # Détermine le destinataire
        recipient = None
        if self.email_to == 'assigned_user' and self.assigned_user_id:
            recipient = self.assigned_user_id.partner_id
        elif self.email_to == 'process_creator':
            recipient = instance.user_id.partner_id
        elif self.email_to == 'custom' and self.email_to_custom:
            recipient = self.env['res.partner'].search([('email', '=', self.email_to_custom)], limit=1)
        
        if recipient:
            self.env['mail.mail'].create({
                'subject': self.email_subject or f'Tâche BPM: {self.name}',
                'body_html': self.email_body or f'<p>Vous avez une nouvelle tâche: {self.name}</p>',
                'email_to': recipient.email,
            }).send()
            _logger.info('✅ Email envoyé à %s', recipient.email)
    
    def _send_validation_notification(self, instance):
        """Envoie une notification Odoo pour validation manuelle"""
        self.ensure_one()
        _logger.info('🔔 Envoi notification de validation pour nœud %s', self.name)
        
        # Récupère l'enregistrement lié
        record = instance.get_record()
        if not record:
            _logger.warning('❌ Impossible d\'envoyer la notification: enregistrement introuvable')
            return
        
        # Détermine les utilisateurs à notifier
        users_to_notify = self.env['res.users']
        
        if self.assigned_user_id:
            users_to_notify |= self.assigned_user_id
        
        if self.assigned_group_id:
            users_to_notify |= self.assigned_group_id.users
        
        if not users_to_notify:
            _logger.warning('⚠️ Aucun utilisateur assigné pour recevoir la notification')
            return
        
        # Prépare le message de notification
        record_name = record.display_name if hasattr(record, 'display_name') else f"#{record.id}"
        title = f"Validation requise: {self.name}"
        message = f"""<p>Une tâche nécessite votre validation:</p>
        <ul>
            <li><strong>Processus:</strong> {instance.process_id.name}</li>
            <li><strong>Étape:</strong> {self.name}</li>
            <li><strong>Enregistrement:</strong> {record_name}</li>
        </ul>
        <p>Cliquez sur cette notification pour accéder à la tâche.</p>"""
        
        # Envoie une notification bus.bus à chaque utilisateur avec action
        for user in users_to_notify:
            if user.partner_id:
                self.env['bus.bus']._sendone(
                    user.partner_id,
                    'simple_notification',
                    {
                        'title': title,
                        'message': message,
                        'type': 'warning',
                        'sticky': True,
                        'action': {
                            'type': 'ir.actions.act_window',
                            'res_model': 'bpm.instance',
                            'res_id': instance.id,
                            'views': [[False, 'form']],
                            'target': 'current',
                        }
                    }
                )
                _logger.info('✅ Notification cliquable envoyée à %s', user.name)
        
        # Poster aussi un message dans le chatter de l'enregistrement si possible
        if hasattr(record, 'message_post'):
            partner_ids = users_to_notify.mapped('partner_id').ids
            record.message_post(
                body=f"""<p>🔔 <strong>Validation BPM requise</strong></p>
                <p>Étape: <strong>{self.name}</strong></p>
                <p>Processus: {instance.process_id.name}</p>""",
                subject=f"Validation requise: {self.name}",
                message_type='notification',
                subtype_xmlid='mail.mt_note',
                partner_ids=partner_ids,
            )
            _logger.info('✅ Message posté dans le chatter avec notification aux utilisateurs')
        
        # Envoyer un email réel à chaque utilisateur
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url')
        instance_url = f"{base_url}/web#id={instance.id}&model=bpm.instance&view_type=form"
        
        for user in users_to_notify:
            if user.email:
                email_body = f"""
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #875A7B;">🔔 Validation BPM requise</h2>
                    <p>Bonjour {user.name},</p>
                    <p>Une tâche nécessite votre validation dans le système BPM:</p>
                    <ul>
                        <li><strong>Processus:</strong> {instance.process_id.name}</li>
                        <li><strong>Étape:</strong> {self.name}</li>
                        <li><strong>Enregistrement:</strong> {record_name}</li>
                    </ul>
                    <p style="margin: 30px 0;">
                        <a href="{instance_url}" 
                           style="background-color: #875A7B; color: white; padding: 12px 30px; 
                                  text-decoration: none; border-radius: 5px; display: inline-block;">
                            ✅ Accéder à la tâche
                        </a>
                    </p>
                    <p style="color: #666; font-size: 12px;">
                        Vous pouvez également accéder à vos tâches en attente depuis le menu BPM dans Odoo.
                    </p>
                </div>
                """
                
                try:
                    # Récupère le serveur SMTP configuré (le premier trouvé)
                    mail_server = self.env['ir.mail_server'].sudo().search([('smtp_host', '!=', False)], limit=1)
                    email_from = mail_server.smtp_user if mail_server and mail_server.smtp_user else user.email
                    
                    mail = self.env['mail.mail'].sudo().create({
                        'subject': f"[BPM] Validation requise: {self.name}",
                        'body_html': email_body,
                        'email_to': user.email,
                        'email_from': email_from,
                        'mail_server_id': mail_server.id if mail_server else False,
                        'auto_delete': False,
                    })
                    mail.send()
                    _logger.info('📧 Email envoyé à %s (%s)', user.name, user.email)
                except Exception as e:
                    _logger.warning('⚠️ Erreur envoi email à %s: %s', user.name, str(e))

    
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
    
    # Type de condition
    condition_type = fields.Selection([
        ('always', 'Toujours'),
        ('simple', 'Condition simple'),
        ('code', 'Code Python'),
    ], string='Type de condition', default='always', required=True)
    
    # Condition simple (sans code)
    condition_field = fields.Char(
        string='Champ',
        help='Nom du champ à comparer (ex: amount_total, state, partner_id.country_id.code)'
    )
    condition_operator = fields.Selection([
        ('>', 'Plus grand que (>)'),
        ('>=', 'Plus grand ou égal (>=)'),
        ('<', 'Plus petit que (<)'),
        ('<=', 'Plus petit ou égal (<=)'),
        ('==', 'Égal à (==)'),
        ('!=', 'Différent de (!=)'),
        ('in', 'Dans la liste (in)'),
        ('not in', 'Pas dans la liste (not in)'),
    ], string='Opérateur')
    condition_value = fields.Char(
        string='Valeur',
        help='Valeur à comparer. Pour les nombres, entrez simplement le nombre (ex: 1000). '
             'Pour les chaînes, utilisez des guillemets (ex: "draft"). '
             'Pour les listes, utilisez des crochets (ex: ["draft", "sent"]).'
    )
    
    # Condition avancée (code Python évalué)
    condition = fields.Text(
        string='Code Python',
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
        # Pas de condition = transition toujours disponible
        if self.condition_type == 'always':
            return True
        
        # Condition simple
        if self.condition_type == 'simple':
            if not self.condition_field or not self.condition_operator:
                _logger.warning('Condition simple incomplète pour la transition %s', self.name)
                return True
            
            try:
                # Récupère la valeur du champ sur l'enregistrement
                field_value = record
                for field_name in self.condition_field.split('.'):
                    field_value = getattr(field_value, field_name, None)
                    if field_value is None:
                        return False
                
                # Prépare la valeur de comparaison
                compare_value = self.condition_value
                if compare_value:
                    # Essaie de convertir en nombre si possible
                    try:
                        compare_value = float(compare_value)
                    except ValueError:
                        # Si ce n'est pas un nombre, évalue la chaîne (pour supporter les listes, etc.)
                        try:
                            compare_value = safe_eval(compare_value, {}, mode='eval')
                        except:
                            # Garde la chaîne telle quelle
                            pass
                
                # Effectue la comparaison
                if self.condition_operator == '>':
                    return field_value > compare_value
                elif self.condition_operator == '>=':
                    return field_value >= compare_value
                elif self.condition_operator == '<':
                    return field_value < compare_value
                elif self.condition_operator == '<=':
                    return field_value <= compare_value
                elif self.condition_operator == '==':
                    return field_value == compare_value
                elif self.condition_operator == '!=':
                    return field_value != compare_value
                elif self.condition_operator == 'in':
                    return field_value in compare_value
                elif self.condition_operator == 'not in':
                    return field_value not in compare_value
                else:
                    return True
                    
            except Exception as e:
                _logger.warning('Erreur lors de l\'évaluation de la condition simple %s: %s', self.name, str(e))
                return False
        
        # Condition avancée (code Python)
        if self.condition_type == 'code':
            if not self.condition:
                return True
            
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
        
        return True


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
    
    # Log des erreurs
    error_log = fields.Text(string='Log des erreurs', readonly=True)
    
    # Compteurs pour boutons intelligents
    invoice_count = fields.Integer(string='Nombre de factures', compute='_compute_invoice_count')
    picking_count = fields.Integer(string='Nombre de livraisons', compute='_compute_picking_count')
    
    def _compute_invoice_count(self):
        """Compte les factures liées à la commande"""
        for record in self:
            record.invoice_count = 0
            if record.res_model == 'sale.order' and record.res_id:
                try:
                    sale_order = self.env['sale.order'].browse(record.res_id)
                    if sale_order.exists():
                        record.invoice_count = len(sale_order.invoice_ids)
                except:
                    pass
    
    def _compute_picking_count(self):
        """Compte les bons de livraison liés à la commande"""
        for record in self:
            record.picking_count = 0
            if record.res_model == 'sale.order' and record.res_id:
                try:
                    sale_order = self.env['sale.order'].browse(record.res_id)
                    if sale_order.exists():
                        record.picking_count = len(sale_order.picking_ids)
                except:
                    pass
    
    def action_view_invoices(self):
        """Ouvre la vue des factures liées"""
        self.ensure_one()
        if self.res_model == 'sale.order' and self.res_id:
            sale_order = self.env['sale.order'].browse(self.res_id)
            invoices = sale_order.invoice_ids
            
            action = self.env['ir.actions.act_window']._for_xml_id('account.action_move_out_invoice_type')
            if len(invoices) > 1:
                action['domain'] = [('id', 'in', invoices.ids)]
            elif len(invoices) == 1:
                action['views'] = [(self.env.ref('account.view_move_form').id, 'form')]
                action['res_id'] = invoices.id
            else:
                action = {'type': 'ir.actions.act_window_close'}
            return action
        return {'type': 'ir.actions.act_window_close'}
    
    def action_view_pickings(self):
        """Ouvre la vue des bons de livraison liés"""
        self.ensure_one()
        if self.res_model == 'sale.order' and self.res_id:
            sale_order = self.env['sale.order'].browse(self.res_id)
            pickings = sale_order.picking_ids
            
            action = self.env['ir.actions.act_window']._for_xml_id('stock.action_picking_tree_all')
            if len(pickings) > 1:
                action['domain'] = [('id', 'in', pickings.ids)]
            elif len(pickings) == 1:
                action['views'] = [(self.env.ref('stock.view_picking_form').id, 'form')]
                action['res_id'] = pickings.id
            else:
                action = {'type': 'ir.actions.act_window_close'}
            return action
        return {'type': 'ir.actions.act_window_close'}
    
    @api.model
    def _get_models(self):
        """Retourne la liste des modèles disponibles"""
        # Utilise sudo() car les utilisateurs normaux n'ont pas accès à ir.model
        models = self.env['ir.model'].sudo().search([])
        return [(model.model, model.name) for model in models]
    
    @api.depends('res_model', 'res_id')
    def _compute_res_record(self):
        """Calcule la référence à l'enregistrement"""
        for record in self:
            if record.res_model and record.res_id:
                try:
                    # Vérifier que le modèle existe
                    if record.res_model in self.env:
                        # Vérifier que l'enregistrement existe
                        target_record = self.env[record.res_model].browse(record.res_id)
                        if target_record.exists():
                            record.res_record = '%s,%s' % (record.res_model, record.res_id)
                        else:
                            record.res_record = False
                    else:
                        record.res_record = False
                except Exception as e:
                    _logger.warning('Erreur lors du calcul de res_record: %s', str(e))
                    record.res_record = False
            else:
                record.res_record = False
    
    @api.model
    def create_from_record(self, process_id, record):
        """
        Crée une instance BPM pour un enregistrement donné
        Méthode utilitaire pour déclencher manuellement un processus
        """
        process = self.env['bpm.process'].sudo().browse(process_id)
        if not process.exists():
            raise UserError(_('Processus BPM introuvable'))
        
        # Crée l'instance
        instance = self.sudo().create({
            'process_id': process.id,
            'res_model': record._name,
            'res_id': record.id,
            'name': f'{process.name} - {record.display_name}',
        })
        
        _logger.info('✅ Instance BPM créée manuellement: ID %d pour %s #%d', 
                     instance.id, record._name, record.id)
        
        # Démarre automatiquement l'instance
        instance.action_start()
        
        return instance
    
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
        
        # Envoie un email si configuré
        self._send_node_email(start_node)
        
        # Avance automatiquement du nœud Start vers le premier nœud réel
        _logger.info('🚀 Avancement automatique du nœud Start vers le nœud suivant')
        self.advance_to_next_node()
        
        return True
    
    def action_next_step(self):
        """
        Moteur d'exécution : passe à l'étape suivante du processus
        
        Cette méthode analyse le nœud actuel et déplace l'état vers le nœud suivant
        en fonction des conditions définies dans les edges.
        """
        self.ensure_one()
        
        _logger.info('=== DEBUG action_next_step ===')
        _logger.info('Instance: %s', self.name)
        _logger.info('res_model: %s', self.res_model)
        _logger.info('res_id: %s', self.res_id)
        _logger.info('state: %s', self.state)
        
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
        if not self.res_model or not self.res_id:
            raise UserError(_('Aucun enregistrement cible défini (modèle ou ID manquant)'))
        
        try:
            record = self.env[self.res_model].browse(self.res_id)
            if not record.exists():
                raise UserError(_('L\'enregistrement cible n\'existe plus (ID: %s)') % self.res_id)
        except Exception as e:
            raise UserError(_('Erreur lors de la récupération de l\'enregistrement: %s') % str(e))
        
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
        
        # Exécute l'action automatique si configurée
        self._execute_auto_action(next_node)
        
        # Exécute le code du nouveau nœud si présent
        self._execute_node_code(next_node)
        
        # Envoie un email si configuré
        self._send_node_email(next_node)
        
        # Si le nouveau nœud est une fin, on termine le processus
        if next_node.node_type == 'end':
            # Déterminer l'état final en fonction du type de fin
            final_state = 'completed'
            if next_node.end_type == 'failure':
                final_state = 'cancelled'
            elif next_node.end_type == 'cancelled':
                final_state = 'cancelled'
            
            self.write({
                'state': final_state,
                'end_date': fields.Datetime.now(),
                'progress': 100.0,
            })
            
            # Exécuter l'action de fin
            self._execute_end_action(next_node)
        
        return True
    
    def _execute_end_action(self, node):
        """
        Exécute l'action de fin définie sur le nœud
        
        :param node: Nœud de type 'end'
        """
        if not node.end_action or node.end_action == 'none':
            return
        
        if not self.res_model or not self.res_id:
            return
        
        record = self.env[self.res_model].browse(self.res_id)
        if not record.exists():
            return
        
        try:
            if node.end_action in ('archive', 'both'):
                # Archiver l'enregistrement s'il a le champ 'active'
                if hasattr(record, 'active'):
                    record.write({'active': False})
                    _logger.info('Enregistrement %s archivé par le processus BPM', record)
            
            if node.end_action in ('notify', 'both'):
                # Envoyer une notification
                message = _('Le processus "%s" est terminé avec le statut: %s') % (
                    self.process_id.name,
                    dict(node._fields['end_type'].selection).get(node.end_type, 'Succès')
                )
                
                # Poster un message sur l'enregistrement s'il a la fonction message_post
                if hasattr(record, 'message_post'):
                    record.message_post(
                        body=message,
                        subject=_('Processus BPM terminé'),
                        message_type='notification'
                    )
                
                # Notifier aussi l'utilisateur qui a lancé le processus
                self.env['bus.bus']._sendone(
                    self.user_id.partner_id,
                    'simple_notification',
                    {
                        'title': _('Processus BPM terminé'),
                        'message': message,
                        'type': 'success' if node.end_type == 'success' else 'warning',
                        'sticky': False,
                    }
                )
                
        except Exception as e:
            _logger.error('Erreur lors de l\'exécution de l\'action de fin: %s', str(e))
        
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
            if not self.res_model or not self.res_id:
                return
            
            record = self.env[self.res_model].browse(self.res_id)
            if not record.exists():
                return
            
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
    
    def _execute_auto_action(self, node):
        """
        Exécute l'action automatique définie sur le nœud
        
        :param node: Nœud BPM
        """
        if not node.auto_action or node.auto_action == 'none':
            return
        
        if not self.res_model or not self.res_id:
            _logger.warning('Impossible d\'exécuter l\'action auto: res_model ou res_id manquant')
            return
        
        record = self.env[self.res_model].browse(self.res_id)
        if not record.exists():
            _logger.warning('Enregistrement %s #%d introuvable', self.res_model, self.res_id)
            return
        
        _logger.info('Exécution action automatique "%s" sur %s #%d', node.auto_action, self.res_model, self.res_id)
        
        try:
            if node.auto_action == 'create_delivery' and self.res_model == 'sale.order':
                # Créer bon de livraison depuis commande
                if hasattr(record, 'action_confirm') and record.state in ('draft', 'sent'):
                    record.action_confirm()
                    _logger.info('✅ Commande confirmée automatiquement')
                
                # Les pickings sont créés automatiquement par Odoo lors de la confirmation
                if record.picking_ids:
                    _logger.info('✅ Bon(s) de livraison créé(s): %s', record.picking_ids.mapped('name'))
                else:
                    _logger.warning('Aucun picking créé pour la commande %s', record.name)
            
            elif node.auto_action == 'create_invoice' and self.res_model == 'sale.order':
                # Créer facture depuis commande
                if record.state == 'sale':
                    invoice = record._create_invoices()
                    _logger.info('✅ Facture créée automatiquement: %s', invoice.name if invoice else 'N/A')
                else:
                    _logger.warning('Commande %s n\'est pas confirmée (état: %s)', record.name, record.state)
            
            elif node.auto_action == 'validate_delivery' and self.res_model == 'stock.picking':
                # Valider livraison
                if record.state == 'assigned':
                    record.button_validate()
                    _logger.info('✅ Livraison validée automatiquement: %s', record.name)
                else:
                    _logger.warning('Livraison %s n\'est pas prête (état: %s)', record.name, record.state)
            
            elif node.auto_action == 'confirm_order' and self.res_model == 'sale.order':
                # Confirmer commande
                if record.state in ('draft', 'sent'):
                    record.action_confirm()
                    _logger.info('✅ Commande confirmée automatiquement: %s', record.name)
            
            elif node.auto_action == 'custom_code':
                # Code Python personnalisé (déjà géré par _execute_node_code)
                pass
                
        except Exception as e:
            _logger.error('Erreur lors de l\'exécution de l\'action auto "%s": %s', node.auto_action, str(e))
            # Ne pas bloquer le workflow, juste logger l'erreur
    
    def _send_node_email(self, node):
        """
        Envoie un email si le nœud est configuré pour cela
        
        :param node: Nœud BPM
        """
        if not node.send_email:
            return
        
        try:
            # Récupère l'enregistrement cible
            if not self.res_model or not self.res_id:
                return
            
            record = self.env[self.res_model].browse(self.res_id)
            if not record.exists():
                return
            
            # Détermine le destinataire
            email_to = None
            if node.email_to == 'assigned_user' and node.assigned_user_id:
                email_to = node.assigned_user_id.email
            elif node.email_to == 'process_creator':
                email_to = self.user_id.email
            elif node.email_to == 'record_salesperson' and hasattr(record, 'user_id'):
                email_to = record.user_id.email
            elif node.email_to == 'custom':
                email_to = node.email_to_custom
            
            if not email_to:
                _logger.warning('Aucun destinataire trouvé pour l\'email du nœud %s', node.name)
                return
            
            # Utilise un template si défini
            if node.email_template_id:
                node.email_template_id.send_mail(record.id, force_send=True, email_values={'email_to': email_to})
                _logger.info('Email envoyé via template pour le nœud %s à %s', node.name, email_to)
            else:
                # Email simple
                subject = node.email_subject or f'Processus BPM : {self.process_id.name}'
                body = node.email_body or f'''
                    <p>Le processus BPM "{self.process_id.name}" a atteint l'étape: <strong>{node.name}</strong></p>
                    <p>Enregistrement concerné: {record.display_name}</p>
                    <p>État du processus: {dict(self._fields['state'].selection).get(self.state)}</p>
                '''
                
                # Envoie l'email
                mail_values = {
                    'subject': subject,
                    'body_html': body,
                    'email_to': email_to,
                    'email_from': self.env.user.email or self.env.company.email,
                    'auto_delete': True,
                }
                mail = self.env['mail.mail'].create(mail_values)
                mail.send()
                _logger.info('Email simple envoyé pour le nœud %s à %s', node.name, email_to)
                
        except Exception as e:
            _logger.error('Erreur lors de l\'envoi de l\'email pour le nœud %s: %s', node.name, str(e))
            # On ne lève pas d'erreur pour ne pas bloquer le workflow
    
    def get_record(self):
        """Retourne l'enregistrement lié à cette instance"""
        self.ensure_one()
        if not self.res_model or not self.res_id:
            return None
        try:
            record = self.env[self.res_model].browse(self.res_id)
            return record if record.exists() else None
        except:
            return None
    
    def advance_to_next_node(self):
        """Avance automatiquement vers le nœud suivant"""
        self.ensure_one()
        _logger.info('🚀 Avancement automatique depuis le nœud %s', self.current_node_id.name)
        
        current_node = self.current_node_id
        record = self.get_record()
        
        if not record:
            raise UserError(_("L'enregistrement lié n'existe plus"))
        
        # Trouve les transitions sortantes
        outgoing_edges = current_node.outgoing_edge_ids.sorted('sequence')
        
        if not outgoing_edges:
            if current_node.node_type == 'end':
                # C'est un nœud de fin, on termine le processus
                self.write({
                    'state': 'completed',
                    'end_date': fields.Datetime.now(),
                })
                _logger.info('✅ Processus terminé')
                return True
            else:
                raise UserError(_('Aucune transition sortante depuis "%s"') % current_node.name)
        
        # Évalue les conditions
        valid_edge = None
        for edge in outgoing_edges:
            if edge.evaluate_condition(record):
                valid_edge = edge
                break
        
        if not valid_edge:
            raise UserError(_('Aucune condition satisfaite pour avancer depuis "%s"') % current_node.name)
        
        next_node = valid_edge.target_node_id
        
        # Met à jour l'instance
        self.write({
            'current_node_id': next_node.id,
            'history_node_ids': [(4, next_node.id)],
        })
        
        _logger.info('➡️ Avancement vers le nœud: %s', next_node.name)
        
        # Exécute le nouveau nœud
        next_node.execute_node(self)
        
        return True
    
    def action_validate_task(self):
        """Valide manuellement la tâche en cours"""
        self.ensure_one()
        
        if self.state != 'running':
            raise UserError(_('Le processus doit être en cours'))
        
        if not self.current_node_id:
            raise UserError(_('Aucun nœud actif'))
        
        if not self.current_node_id.requires_validation:
            raise UserError(_('Ce nœud ne nécessite pas de validation manuelle'))
        
        # Vérifie les permissions
        if self.current_node_id.assigned_user_id:
            if self.env.user != self.current_node_id.assigned_user_id:
                raise UserError(_('Seul %s peut valider cette tâche') % self.current_node_id.assigned_user_id.name)
        elif self.current_node_id.assigned_group_id:
            if not self.env.user.has_group(self.current_node_id.assigned_group_id.full_name):
                raise UserError(_('Vous n\'êtes pas dans le groupe autorisé'))
        
        _logger.info('✅ Validation manuelle de la tâche "%s" par %s', self.current_node_id.name, self.env.user.name)
        
        # Avance au nœud suivant
        self.advance_to_next_node()
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Tâche validée'),
                'message': _('La tâche a été validée avec succès'),
                'type': 'success',
                'sticky': False,
            }
        }
    
    def action_reject_task(self):
        """Refuse la tâche et annule le processus"""
        self.ensure_one()
        
        if self.state != 'running':
            raise UserError(_('Le processus doit être en cours'))
        
        if not self.current_node_id:
            raise UserError(_('Aucun nœud actif'))
        
        if not self.current_node_id.requires_validation:
            raise UserError(_('Ce nœud ne nécessite pas de validation manuelle'))
        
        # Vérifie les permissions (même logique que validate)
        if self.current_node_id.assigned_user_id:
            if self.env.user != self.current_node_id.assigned_user_id:
                raise UserError(_('Seul %s peut refuser cette tâche') % self.current_node_id.assigned_user_id.name)
        elif self.current_node_id.assigned_group_id:
            if not self.env.user.has_group(self.current_node_id.assigned_group_id.full_name):
                raise UserError(_('Vous n\'êtes pas dans le groupe autorisé'))
        
        _logger.info('❌ Refus de la tâche "%s" par %s', self.current_node_id.name, self.env.user.name)
        
        # Annule le processus
        self.write({
            'state': 'cancelled',
            'end_date': fields.Datetime.now(),
        })
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Tâche refusée'),
                'message': _('Le processus a été annulé'),
                'type': 'warning',
                'sticky': False,
            }
        }
    
    @api.model
    def create(self, vals):
        """Surcharge pour définir automatiquement res_record depuis res_model et res_id"""
        _logger.info('=== DEBUG CREATE ===')
        _logger.info('vals IN: %s', vals)
        
        if 'res_model' in vals and 'res_id' in vals and vals['res_model'] and vals['res_id']:
            vals['res_record'] = '%s,%s' % (vals['res_model'], vals['res_id'])
            _logger.info('Setting res_record from res_model and res_id: %s', vals['res_record'])
        elif 'res_record' in vals and vals['res_record']:
            res_record = vals['res_record']
            if isinstance(res_record, str) and ',' in res_record:
                res_model, res_id = res_record.split(',')
                vals['res_model'] = res_model
                vals['res_id'] = int(res_id)
                _logger.info('Setting res_model and res_id from res_record: %s, %s', res_model, res_id)
        
        _logger.info('vals OUT: %s', vals)
        result = super().create(vals)
        _logger.info('Created instance ID %s with res_model=%s, res_id=%s', result.id, result.res_model, result.res_id)
        return result
    
    def write(self, vals):
        """Surcharge pour mettre à jour res_record depuis res_model et res_id"""
        _logger.info('=== DEBUG WRITE ===')
        _logger.info('Instance ID: %s', self.ids)
        _logger.info('vals IN: %s', vals)
        _logger.info('BEFORE - res_model: %s, res_id: %s', self.res_model, self.res_id)
        
        if 'res_model' in vals and 'res_id' in vals:
            if vals.get('res_model') and vals.get('res_id'):
                vals['res_record'] = '%s,%s' % (vals['res_model'], vals['res_id'])
                _logger.info('Setting res_record from both: %s', vals['res_record'])
        elif ('res_model' in vals and vals['res_model']) or ('res_id' in vals and vals['res_id']):
            # Si seulement res_model ou res_id est modifié, on reconstruit res_record
            res_model = vals.get('res_model', self.res_model)
            res_id = vals.get('res_id', self.res_id)
            _logger.info('Reconstructing - res_model: %s, res_id: %s', res_model, res_id)
            if res_model and res_id:
                vals['res_record'] = '%s,%s' % (res_model, res_id)
                _logger.info('Setting res_record from rebuild: %s', vals['res_record'])
        elif 'res_record' in vals and vals['res_record']:
            res_record = vals['res_record']
            if isinstance(res_record, str) and ',' in res_record:
                res_model, res_id = res_record.split(',')
                vals['res_model'] = res_model
                vals['res_id'] = int(res_id)
                _logger.info('Setting from res_record: res_model=%s, res_id=%s', res_model, res_id)
        
        _logger.info('vals OUT: %s', vals)
        result = super().write(vals)
        _logger.info('AFTER WRITE - res_model: %s, res_id: %s', self.res_model, self.res_id)
        return result

