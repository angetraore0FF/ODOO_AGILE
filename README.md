# 🚀 ODOO_AGILE - Module BPM avec Éditeur Graphique

> **Module d'automatisation de workflows métiers pour Odoo 18**  
> Créez, automatisez et pilotez vos processus d'entreprise avec un éditeur visuel intuitif

![Version](https://img.shields.io/badge/version-18.0.1.0.0-blue)
![License](https://img.shields.io/badge/license-LGPL--3-green)
![Odoo](https://img.shields.io/badge/Odoo-18.0-purple)

---

## 📋 Présentation

**ODOO_AGILE** est un module BPM (Business Process Management) professionnel qui transforme la façon dont vous gérez vos processus métiers dans Odoo. Avec son éditeur graphique intuitif et son moteur d'automatisation puissant, vous pouvez:

- ✅ **Concevoir** visuellement vos workflows métiers
- ✅ **Automatiser** les actions Odoo (commandes, factures, livraisons)
- ✅ **Déclencher** automatiquement les processus selon des conditions
- ✅ **Suivre** en temps réel l'avancement de chaque instance
- ✅ **Piloter** vos processus avec des indicateurs intelligents

---

## 🎯 Ce qui Fonctionne Actuellement

### ✨ Fonctionnalités Opérationnelles

| Fonctionnalité | Status | Description |
|----------------|--------|-------------|
| 🎨 Éditeur graphique | ✅ **100%** | Création visuelle de workflows avec nœuds et transitions |
| ⚡ Auto-déclenchement | ✅ **100%** | Démarrage automatique des processus selon conditions |
| 🤖 Actions automatiques | ✅ **100%** | 5 types d'actions Odoo (commandes, factures, livraisons) |
| 📊 Conditions simplifiées | ✅ **100%** | Configuration sans code Python |
| 📈 Suivi d'instances | ✅ **100%** | Dashboard avec progression et historique |
| 🔔 Boutons intelligents | ✅ **100%** | Accès direct aux factures et livraisons |
| 📚 Templates | ✅ **100%** | 2 workflows prédéfinis prêts à l'emploi |

---

## 🎬 Démonstration des Workflows

### Workflow 1: Processus de Vente Automatisé

**Objectif:** Automatiser le cycle complet Commande → Livraison → Facturation

```
┌─────────┐     ┌─────────────┐     ┌──────────────┐     ┌──────────┐     ┌─────────────┐     ┌─────────┐
│ Début   │────▶│ Vérification│────▶│ Montant > ? │────▶│ Commande │────▶│ Facturation │────▶│ Terminé │
└─────────┘     └─────────────┘     └──────────────┘     │ approuvée│     └─────────────┘     └─────────┘
                                            │              └──────────┘
                                            │ Montant < 1000€
                                            ▼
                                     ┌──────────┐
                                     │ Rejeté   │
                                     └──────────┘
```

**Configuration du workflow:**

| Étape | Action Automatique | Condition |
|-------|-------------------|-----------|
| Début | - | Déclenchement si `montant > 1000€` |
| Vérification | - | - |
| Montant suffisant? | - | Transition si `amount_total > 1000` |
| Commande approuvée | 🚚 **Créer bon de livraison** | - |
| Facturation | 📄 **Créer facture** | - |
| Terminé | - | Processus complété |

**Résultat attendu:**

1. **Création automatique** d'une instance BPM
2. **Bon de livraison** généré automatiquement
3. **Facture** créée automatiquement
4. **Boutons intelligents** affichés:
   - 📄 Factures (1)
   - 🚚 Livraisons (1)

---

### Workflow 2: Validation de Commandes selon Montant

**Objectif:** Processus d'approbation différencié selon le montant

```
                              ┌──────────────────┐
                              │  Nouvelle       │
                              │  Commande       │
                              └────────┬─────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │  Montant < 1000€ ?          │
                        └──────┬──────────────┬────────┘
                               │              │
                     OUI       │              │      NON
                               ▼              ▼
                   ┌────────────────┐  ┌──────────────────┐
                   │ Auto-validation│  │ Validation       │
                   │ ✅ Confirmée   │  │ manuelle requise │
                   └────────────────┘  └──────────────────┘
```

**Cas d'usage réel:**

- **Petites commandes (< 1000€):** Validation automatique immédiate
- **Grandes commandes (≥ 1000€):** Passage par un responsable

**Configuration:**

```python
# Transition "Petite commande"
Champ:      amount_total
Opérateur:  <
Valeur:     1000
Action:     confirm_order (Confirmer automatiquement)

# Transition "Grande commande"  
Champ:      amount_total
Opérateur:  >=
Valeur:     1000
Action:     none (Validation manuelle)
```

---

## 🛠️ Guide d'Utilisation Pas à Pas

### Étape 1: Créer un Processus BPM

**Navigation:** `BPM → Processus → Créer`

**Configuration obligatoire:**
```
Nom:                    "Workflow Ventes Automatisé"
Modèle:                 sale.order (Commande de vente)
Démarrage automatique:  ✅ Oui
Déclencheur:            À la création
Condition:              record.state == 'draft' and record.amount_total > 1000
```

### Étape 2: Concevoir le Workflow (Onglet Nœuds)

**Créer les nœuds suivants:**

| # | Nom | Type | Action Automatique | Position X/Y |
|---|-----|------|-------------------|--------------|
| 1 | Début | Début | Aucune | 100 / 200 |
| 2 | Vérification | Tâche | Aucune | 250 / 200 |
| 3 | Montant suffisant? | Passerelle (Décision) | Aucune | 400 / 200 |
| 4 | Commande approuvée | Tâche | **Créer bon de livraison** | 550 / 150 |
| 5 | Facturation | Tâche | **Créer facture** | 625 / 150 |
| 6 | Terminé | Fin | Aucune | 700 / 150 |
| 7 | Rejeté | Fin | Aucune | 550 / 250 |

### Étape 3: Connecter les Nœuds (Onglet Transitions)

**Créer les transitions:**

| Nom | Source | Cible | Type Condition | Configuration |
|-----|--------|-------|----------------|---------------|
| Démarrage | Début | Vérification | Toujours | - |
| Vers décision | Vérification | Montant suffisant? | Toujours | - |
| Montant OK | Montant suffisant? | Commande approuvée | **Condition simple** | `amount_total > 1000` |
| Montant KO | Montant suffisant? | Rejeté | **Condition simple** | `amount_total <= 1000` |
| Livraison faite | Commande approuvée | Facturation | Toujours | - |
| Facture créée | Facturation | Terminé | Toujours | - |

**Configuration des conditions simples:**
```
Montant OK:
  Champ:      amount_total
  Opérateur:  >
  Valeur:     1000

Montant KO:
  Champ:      amount_total
  Opérateur:  <=
  Valeur:     1000
```

### Étape 4: Configuration Produits (Important!)

**Pour que la facturation fonctionne:**

```
Inventaire → Produits → [Votre produit]
→ Onglet "Informations générales"
→ Politique de facturation: "Quantités commandées"
→ Sauvegarder
```

### Étape 5: Tester le Workflow

**1. Créer une commande de test:**
```
Ventes → Commandes → Créer
Client:    Deco Addict (ou autre)
Produit:   Computer Case (ou autre)
Quantité:  5
Prix:      250€ (Total: 1250€ > 1000€)
→ Confirmer la commande
```

**2. Vérifier l'instance BPM:**
```
BPM → Instances
→ Une nouvelle instance "Test Vente Simple - S000XX" apparaît automatiquement!
```

**3. Exécuter le workflow:**
```
→ Ouvrir l'instance
→ Cliquer "Démarrer"
→ Cliquer "Étape suivante" (répéter jusqu'à "Facturation")
→ Observer les boutons intelligents apparaître!
```

**4. Vérifier les résultats:**
```
📄 Bouton "Factures (1)" → Cliquer pour voir la facture créée
🚚 Bouton "Livraisons (1)" → Cliquer pour voir le bon de livraison
```

---

## 📊 Fonctionnalités Techniques Détaillées

### 1. Éditeur Graphique de Workflow

**Caractéristiques:**
- Glisser-déposer des nœuds
- Connexion visuelle par transitions
- Positionnement libre (coordonnées X/Y)
- Validation automatique de cohérence

**Types de nœuds disponibles:**
- 🟢 **Start** (Début) - Point d'entrée unique
- 🔵 **Task** (Tâche) - Étape de traitement
- 🟡 **Gateway** (Passerelle) - Point de décision
- 🔴 **End** (Fin) - Point de sortie (succès/échec/annulation)

### 2. Auto-déclenchement des Processus

**Mécanisme:**
```python
# Hook dynamique sur sale.order.create
def _register_hook(self):
    # Patch automatique des méthodes create/write
    # Déclenche le workflow selon les conditions
```

**Exemple de condition:**
```python
record.state == 'draft' and record.amount_total > 1000
```

**Logs de déclenchement:**
```
INFO: === _trigger_bpm_process appelé pour sale.order #36 ===
INFO: Processus correspondants trouvés: 1
INFO: ✅ Instance BPM créée automatiquement: ID 23 pour sale.order #36
```

### 3. Actions Automatiques

**5 types d'actions disponibles:**

#### 3.1 Confirmer Commande (`confirm_order`)
```python
if record.state in ('draft', 'sent'):
    record.action_confirm()
    _logger.info('✅ Commande confirmée automatiquement')
```

#### 3.2 Créer Bon de Livraison (`create_delivery`)
```python
# Confirme la commande
record.action_confirm()
# Les pickings sont créés automatiquement par Odoo
_logger.info('✅ Bon(s) de livraison créé(s)')
```
⚠️ **Nécessite:** Module Stock/Inventory installé

#### 3.3 Créer Facture (`create_invoice`)
```python
if record.state == 'sale':
    invoice = record._create_invoices()
    _logger.info('✅ Facture créée: %s', invoice.name)
```
⚠️ **Nécessite:** Politique de facturation = "Quantités commandées"

#### 3.4 Valider Livraison (`validate_delivery`)
```python
if record.state == 'assigned':
    record.button_validate()
    _logger.info('✅ Livraison validée')
```

#### 3.5 Code Python Personnalisé (`custom_code`)
```python
# Contexte d'exécution sécurisé avec safe_eval
eval_context = {
    'record': record,    # Enregistrement cible
    'instance': self,    # Instance BPM
    'node': node,        # Nœud actuel
    'env': self.env,     # Environnement Odoo
    'datetime': datetime,
    'log': _logger
}
safe_eval(node.action_code, eval_context, mode='exec')
```

### 4. Conditions Simplifiées (Sans Code!)

**3 modes disponibles:**

#### Mode 1: Toujours
```
La transition est toujours prise
```

#### Mode 2: Condition Simple (NOUVEAU!)
```
Interface graphique intuitive:
  Champ:      amount_total
  Opérateur:  > (plus grand que)
  Valeur:     1000
```

**Opérateurs supportés:**
- `>` Plus grand que
- `>=` Plus grand ou égal
- `<` Plus petit que
- `<=` Plus petit ou égal
- `==` Égal à
- `!=` Différent de
- `in` Dans la liste
- `not in` Pas dans la liste

#### Mode 3: Code Python
```python
record.amount_total > 1000 and record.state == 'draft'
```

### 5. Boutons Intelligents

**Compteurs dynamiques:**
```python
def _compute_invoice_count(self):
    """Compte les factures liées à la commande"""
    if self.res_model == 'sale.order':
        sale_order = self.env['sale.order'].browse(self.res_id)
        self.invoice_count = len(sale_order.invoice_ids)
```

**Actions associées:**
```python
def action_view_invoices(self):
    """Ouvre la vue des factures"""
    # Ouvre automatiquement la liste ou le formulaire
    # selon le nombre de factures
```

**Résultat visuel:**
```
┌─────────────────────┐
│  📄 Factures (2)   │  ← Clic ouvre les factures
├─────────────────────┤
│  🚚 Livraisons (1) │  ← Clic ouvre les pickings
└─────────────────────┘
```

---

## 📦 Installation et Prérequis

### Prérequis Système

```yaml
Odoo:      18.0
Python:    3.11+
Database:  PostgreSQL 12+
RAM:       4GB minimum
```

### Modules Odoo Requis

| Module | Nécessaire pour | Installation |
|--------|----------------|--------------|
| **sale** | Commandes de vente | Installé par défaut |
| **stock** | Bons de livraison | `Apps → Inventory → Install` |
| **account** | Factures | Installé par défaut |
| **mail** | Notifications email | Installé par défaut |

### Installation du Module

**Méthode 1: Installation manuelle**
```bash
cd /chemin/vers/odoo/custom_addons/
git clone https://github.com/angetraore0FF/ODOO_AGILE.git
python odoo-bin -c odoo.conf -u ODOO_AGILE
```

**Méthode 2: Interface Odoo**
```
1. Copier le dossier dans custom_addons/
2. Apps → Mettre à jour la liste des applications
3. Rechercher "BPM"
4. Cliquer "Installer"
```

---

## 🐛 Résolution de Problèmes

### Problème 1: Erreur `'sale.order' object has no attribute 'picking_ids'`

**Cause:** Module Stock non installé

**Solution:**
```
Apps → Rechercher "Inventory" → Installer
Redémarrer: python odoo-bin -c odoo.conf
```

### Problème 2: Erreur `Cannot create an invoice`

**Cause:** Politique de facturation incorrecte

**Solution:**
```
Inventaire → Produits → [Produit] 
→ Onglet "Général"
→ Politique de facturation: "Quantités commandées"
→ Sauvegarder
```

### Problème 3: Les boutons "Factures" n'apparaissent pas

**Cause:** Aucune facture créée (erreur silencieuse)

**Diagnostic:**
```bash
# Consulter les logs du serveur
grep "ERROR" odoo.log | grep "create_invoice"
```

**Solutions possibles:**
- Vérifier la politique de facturation du produit
- Vérifier que la commande est confirmée (state = 'sale')
- Vérifier les logs pour l'erreur exacte

### Problème 4: Le workflow ne démarre pas automatiquement

**Vérifications:**
```
1. Processus → Démarrage automatique: ✅ Activé
2. Condition de déclenchement: Vérifier la syntaxe
3. Logs serveur: Rechercher "_trigger_bpm_process"
```

---

## 📈 Statistiques du Projet

```
📊 Lignes de code:        ~1200 Python + 350 XML
🎯 Modèles:               5 (process, node, edge, instance, template)
🖥️ Vues:                  15+ (forms, lists, kanban, éditeur)
🤖 Actions automatiques:  5 types
📚 Templates:             2 prédéfinis
✅ Phases complètes:      1.5 / 6 (25%)
⏱️ Temps développement:  ~40 heures
```

---

## 🗺️ Roadmap

### ✅ Phase 1: Schématisation (75% Complété)
- [x] Éditeur graphique de workflow
- [x] Validation automatique
- [x] Auto-déclenchement des processus
- [ ] Export en PNG/SVG/PDF (À venir)
- [ ] Vue schématique lecture seule (À venir)

### 🚧 Phase 4: Automatisation (60% Complété)
- [x] Actions automatiques (5 types)
- [x] Conditions simplifiées
- [x] Boutons intelligents
- [ ] Règles avancées (stock insuffisant, etc.)
- [ ] Gestion d'erreurs avancée

### 📅 Phase 2-3-5-6: À Venir
- Templates additionnels
- Actions avancées (créer enregistrement, mapper champs)
- Configuration SMTP
- Dashboard et statistiques

---

## 🎓 Exemples de Code Personnalisé

### Exemple 1: Assignation automatique de commercial

```python
# Dans action_code d'un nœud
if record.amount_total > 5000:
    # Grandes commandes → Commercial senior
    record.user_id = env['res.users'].search([
        ('name', '=', 'Senior Sales Manager')
    ], limit=1)
    log.info(f'Commande {record.name} assignée à un senior')
else:
    # Petites commandes → Round-robin
    users = env['res.users'].search([
        ('groups_id', 'in', env.ref('sales_team.group_sale_salesman').id)
    ])
    record.user_id = users[record.id % len(users)]
```

### Exemple 2: Création d'une tâche projet

```python
# Créer une tâche dans Project quand commande confirmée
if record.state == 'sale':
    env['project.task'].create({
        'name': f'Préparer commande {record.name}',
        'project_id': env.ref('project.project_warehouse').id,
        'user_id': record.user_id.id,
        'description': f'Client: {record.partner_id.name}\n'
                      f'Montant: {record.amount_total}€'
    })
    log.info('Tâche projet créée')
```

### Exemple 3: Notification conditionnelle

```python
# Envoyer email au responsable si commande > 10k€
if record.amount_total > 10000:
    manager = env['res.users'].search([
        ('name', '=', 'Sales Director')
    ], limit=1)
    
    env['mail.mail'].create({
        'subject': f'⚠️ Grande commande: {record.name}',
        'body_html': f'<p>Montant: {record.amount_total}€</p>',
        'email_to': manager.email,
        'auto_delete': True
    }).send()
```

---

## 🤝 Contribution

Contributions bienvenues! 

**Pour contribuer:**
```bash
1. Fork le projet
2. Crée une branche (git checkout -b feature/AmazingFeature)
3. Commit (git commit -m 'Add AmazingFeature')
4. Push (git push origin feature/AmazingFeature)
5. Ouvre une Pull Request
```

**Guidelines:**
- Code propre et commenté
- Tests fonctionnels
- Documentation mise à jour
- Respect des conventions Odoo

---

## 📞 Support et Contact

- 🐛 **Issues:** https://github.com/angetraore0FF/ODOO_AGILE/issues
- 📧 **Email:** contact@vectal.app
- 📖 **Documentation complète:** Voir ROADMAP.md
- 💬 **Discussions:** GitHub Discussions

---

## 📄 Licence

**LGPL-3.0 License**

Ce module est distribué sous licence LGPL-3. Voir le fichier LICENSE pour plus de détails.

---

## 🙏 Remerciements

- **Odoo SA** pour le framework extraordinaire
- **La communauté Odoo** pour les bonnes pratiques
- **Tous les contributeurs** du projet

---

## 📝 Changelog

### Version 18.0.1.0.0 (2026-02-02)

**🎉 Release initiale**

**Fonctionnalités principales:**
- ✨ Éditeur graphique de workflows
- ⚡ Auto-déclenchement des processus
- 🤖 5 types d'actions automatiques
- 📊 Conditions simplifiées sans code
- 📈 Suivi d'instances en temps réel
- 🔔 Boutons intelligents (Factures/Livraisons)
- 📚 2 templates prédéfinis

**Corrections techniques:**
- Fix: Renommage _execute_node_code en _send_node_email
- Fix: Ajout dépendance 'mail' pour email_template_id
- Fix: Implémentation evaluate_condition pour conditions simplifiées
- Fix: Compute methods pour boutons intelligents

**Documentation:**
- README complet avec exemples
- ROADMAP détaillé
- Commentaires de code enrichis

---

<div align="center">

**⭐ Si ce module vous aide, mettez une étoile sur GitHub! ⭐**

[🌟 Star sur GitHub](https://github.com/angetraore0FF/ODOO_AGILE) | [📖 Documentation](./ROADMAP.md) | [🐛 Reporter un Bug](https://github.com/angetraore0FF/ODOO_AGILE/issues)

---

**Développé avec ❤️ par Ange Traoré**

*Transformez vos processus métiers avec ODOO_AGILE*

</div>
5. Utilisez les boutons pour ajouter des nœuds :
   - **Ajouter Début** : Point de départ
   - **Ajouter Tâche** : Étape de traitement
   - **Ajouter Décision** : Point de branchement
   - **Ajouter Fin** : Point d'arrivée
6. Cliquez sur un nœud puis sur "Connecter" pour créer des transitions
7. Cliquez sur une transition pour définir sa condition

### Lancer un Processus

#### Option 1 : Depuis un modèle avec le mixin BPM

Si votre modèle hérite de `bpm.mixin` :

```python
class YourModel(models.Model):
    _name = 'your.model'
    _inherit = ['bpm.mixin']
```

Un bouton "Lancer le processus" apparaîtra automatiquement dans la vue formulaire.

#### Option 2 : Depuis le menu BPM

1. Allez dans **BPM > Instances**
2. Créez une nouvelle instance
3. Sélectionnez le processus et l'enregistrement cible
4. Cliquez sur "Démarrer"

### Exécuter une Instance

1. Ouvrez l'instance depuis **BPM > Instances**
2. Cliquez sur "Démarrer" pour lancer le processus
3. Utilisez "Étape suivante" pour avancer manuellement
4. Le processus se termine automatiquement lorsqu'il atteint un nœud de fin

## Architecture Technique

### Modèles

- **bpm.process** : Conteneur du processus
- **bpm.node** : Nœud (étape) du processus
- **bpm.edge** : Transition entre deux nœuds
- **bpm.instance** : Instance d'exécution d'un processus

### Moteur d'Exécution

Le moteur d'exécution (`action_next_step()`) :
1. Analyse le nœud actuel
2. Évalue les conditions des transitions sortantes
3. Sélectionne la première transition valide
4. Déplace l'instance vers le nœud suivant
5. Exécute le code Python du nœud (si présent)
6. Termine automatiquement si le nœud est de type "end"

### Éditeur Graphique

L'éditeur utilise :
- **SVG** pour le rendu graphique
- **OWL 2** (Odoo Web Library) pour le composant
- **JavaScript** pour l'interaction utilisateur

## Exemples de Conditions

### Condition simple

```python
record.state == 'draft'
```

### Condition avec comparaison numérique

```python
record.amount > 1000
```

### Condition avec date

```python
record.date_deadline < datetime.datetime.now()
```

### Condition complexe

```python
record.state == 'approved' and record.amount > 5000
```

## Code d'Action sur un Nœud

Vous pouvez exécuter du code Python lorsqu'un nœud est atteint :

```python
# Exemple : Envoyer un email
record.message_post(
    body='Le processus a atteint l\'étape : Validation',
    subject='Notification BPM'
)

# Exemple : Modifier un champ
record.write({'state': 'in_progress'})
```

Variables disponibles :
- `record` : L'enregistrement du modèle cible
- `instance` : L'instance BPM actuelle
- `node` : Le nœud actuel
- `env` : L'environnement Odoo
- `datetime` : Module datetime Python
- `dateutil` : Module dateutil Python

## Sécurité

Les droits d'accès sont définis dans `security/ir.model.access.csv` :
- **Gestionnaires système** : Accès complet (CRUD)
- **Utilisateurs** : Lecture seule sur les processus, création/lecture sur les instances

## Développement

### Ajouter le mixin à un modèle existant

```python
class SaleOrder(models.Model):
    _name = 'sale.order'
    _inherit = ['sale.order', 'bpm.mixin']
```

### Créer un processus programmatiquement

```python
process = self.env['bpm.process'].create({
    'name': 'Processus de validation',
    'model_id': self.env.ref('base.model_sale_order').id,
    'version': '1.0',
})

# Créer des nœuds
start_node = self.env['bpm.node'].create({
    'name': 'Début',
    'process_id': process.id,
    'node_type': 'start',
    'position_x': 100,
    'position_y': 100,
})

# Créer des transitions
edge = self.env['bpm.edge'].create({
    'name': 'Validation',
    'process_id': process.id,
    'source_node_id': start_node.id,
    'target_node_id': end_node.id,
    'condition': 'record.state == "draft"',
})
```

## Support

Pour toute question ou problème, veuillez consulter la documentation Odoo ou contacter le support.

## Licence

LGPL-3

