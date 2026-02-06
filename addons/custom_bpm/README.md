# Module Custom BPM - Gestion de Processus Métiers

Module Odoo 19 pour la gestion de processus métiers (BPM) avec éditeur graphique de workflow.

## 📋 Table des matières

- [Installation](#installation)
- [Fonctionnalités](#fonctionnalités)
- [Exemple de Processus](#exemple-de-processus)
- [Guide d'utilisation](#guide-dutilisation)
- [Architecture](#architecture)

## 🚀 Installation

1. Placez le module dans le dossier `addons` d'Odoo
2. Mettez à jour la liste des applications
3. Installez le module "Gestion BPM avec Éditeur Graphique"
4. Le module charge automatiquement l'exemple de processus

## ✨ Fonctionnalités

- **Éditeur graphique de workflow** (style draw.io)
- **Types de nœuds** : Début, Tâche, Décision (Gateway), Fin
- **Conditions de transition** : Toujours, Condition simple, Code Python
- **Actions automatiques** : Confirmation de commande, Création de facture, etc.
- **Suivi en temps réel** des instances de processus
- **Chatter intégré** pour les notifications
- **Application sur n'importe quel modèle Odoo**

## 📊 Exemple de Processus : Validation de Commande de Vente

### Vue d'ensemble

Ce processus illustre un workflow complet de validation de commande de vente avec vérification du stock et création de facture.

### Structure du Workflow

```
┌─────────────────┐
│  DÉBUT          │
│  Commande       │
│  créée          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  TÂCHE          │
│  Vérification   │
│  du stock       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  DÉCISION       │
│  Stock          │
│  disponible ?   │
└────┬────────┬───┘
     │        │
     │ OUI    │ NON
     │        │
     ▼        ▼
┌─────────┐ ┌──────────────────────┐
│ TÂCHE   │ │ TÂCHE                │
│ Confirmer│ │ Demander             │
│ commande│ │ approvisionnement    │
└────┬────┘ └──────┬───────────────┘
     │             │
     ▼             ▼
┌─────────┐ ┌──────────────┐
│ TÂCHE   │ │ FIN          │
│ Créer   │ │ Commande     │
│ facture │ │ en attente   │
└────┬────┘ └──────────────┘
     │
     ▼
┌─────────┐
│ FIN     │
│ Commande│
│ validée │
└─────────┘
```

### Détails des Nœuds

#### 1. **DÉBUT - Commande créée**
- **Type** : `start`
- **Description** : Point de départ du processus. La commande vient d'être créée.
- **Position** : (100, 100)

#### 2. **TÂCHE - Vérification du stock**
- **Type** : `task`
- **Description** : Vérifie la disponibilité des produits en stock
- **Action automatique** : Aucune (peut être personnalisée avec du code Python)
- **Position** : (300, 100)

#### 3. **DÉCISION - Stock disponible ?**
- **Type** : `gateway`
- **Description** : Décision : le stock est-il suffisant pour honorer la commande ?
- **Position** : (500, 100)
- **Conditions de sortie** :
  - **OUI** : Si `record.amount_total > 0` → Vers "Confirmer la commande"
  - **NON** : Si `record.amount_total <= 0` → Vers "Demander approvisionnement"

#### 4. **TÂCHE - Confirmer la commande**
- **Type** : `task`
- **Description** : Confirme la commande de vente (appelle `action_confirm()`)
- **Action automatique** : `confirm_order`
- **Position** : (700, 50)

#### 5. **TÂCHE - Demander approvisionnement**
- **Type** : `task`
- **Description** : Crée une demande d'approvisionnement si le stock est insuffisant
- **Action automatique** : Code Python personnalisé
- **Position** : (700, 150)

#### 6. **TÂCHE - Créer la facture**
- **Type** : `task`
- **Description** : Crée la facture pour la commande confirmée
- **Action automatique** : `create_invoice`
- **Position** : (900, 50)

#### 7. **FIN - Commande validée** (Succès)
- **Type** : `end`
- **Type de fin** : `success`
- **Action de fin** : `notify` (envoie une notification)
- **Description** : Le processus se termine avec succès. La commande est validée et facturée.
- **Position** : (1100, 50)

#### 8. **FIN - Commande en attente** (Échec)
- **Type** : `end`
- **Type de fin** : `failure`
- **Action de fin** : `notify` (envoie une notification)
- **Description** : Le processus se termine en attente d'approvisionnement.
- **Position** : (900, 150)

### Transitions

| ID | Nom | Source | Cible | Condition |
|----|-----|--------|-------|-----------|
| 1 | Démarrer vérification | Début | Vérification stock | Toujours |
| 2 | Vers décision | Vérification stock | Décision stock | Toujours |
| 3 | OUI - Stock disponible | Décision stock | Confirmer commande | `record.amount_total > 0` |
| 4 | NON - Stock insuffisant | Décision stock | Demander approvisionnement | `record.amount_total <= 0` |
| 5 | Créer facture | Confirmer commande | Créer facture | Toujours |
| 6 | Terminer avec succès | Créer facture | Commande validée | Toujours |
| 7 | Terminer en attente | Demander approvisionnement | Commande en attente | Toujours |

## 📖 Guide d'utilisation

### 1. Créer une instance de processus

#### Méthode manuelle :
1. Aller dans **Processus BPM → Instances BPM**
2. Cliquer sur **Créer**
3. Remplir les champs :
   - **Nom** : Ex: "Instance Commande SO001"
   - **Processus** : Sélectionner "Validation de Commande de Vente"
   - **Modèle** : `sale.order`
   - **ID de l'enregistrement** : ID de la commande de vente (ex: 1)

#### Méthode automatique (si activée) :
- Si `auto_start = True` sur le processus, une instance est créée automatiquement lors de la création/modification d'une commande de vente

### 2. Exécuter le processus

1. Ouvrir l'instance créée
2. Cliquer sur **Démarrer** (bouton dans l'en-tête)
3. Le processus passe au nœud de départ
4. Cliquer sur **Étape suivante** pour avancer dans le workflow
5. Le système évalue automatiquement les conditions et choisit le bon chemin

### 3. Suivre la progression

- **Barre de progression** : Affiche le pourcentage d'avancement
- **Nœud actuel** : Indique l'étape en cours
- **Historique** : Liste tous les nœuds visités
- **Chatter** : Messages automatiques à chaque étape

### 4. Conditions de transition

#### Condition "Toujours"
- La transition est toujours disponible
- Pas de vérification nécessaire

#### Condition "Code Python"
- Expression Python évaluée sur l'enregistrement
- Utilisez `record` pour référencer l'enregistrement du modèle cible
- Exemple : `record.amount_total > 1000`
- Exemple : `record.partner_id.country_id.code == 'FR'`

#### Condition "Simple"
- Comparaison directe d'un champ
- Opérateurs disponibles : `>`, `>=`, `<`, `<=`, `==`, `!=`, `in`, `not in`

## 🏗️ Architecture

### Modèles principaux

- **`bpm.process`** : Conteneur du processus (définition du workflow)
- **`bpm.node`** : Étapes du processus (Début, Tâche, Décision, Fin)
- **`bpm.edge`** : Transitions entre les nœuds (avec conditions)
- **`bpm.instance`** : Suivi des processus lancés (exécution)

### Relations

```
bpm.process (1) ──→ (N) bpm.node
bpm.process (1) ──→ (N) bpm.edge
bpm.process (1) ──→ (N) bpm.instance
bpm.node (1) ──→ (N) bpm.edge (source)
bpm.node (1) ──→ (N) bpm.edge (target)
bpm.instance (1) ──→ (1) bpm.node (current_node_id)
```

### Types de nœuds

| Type | Description | Actions disponibles |
|------|-------------|---------------------|
| `start` | Point de départ | Aucune |
| `task` | Tâche à exécuter | `confirm_order`, `create_invoice`, `create_delivery`, `validate_delivery`, `custom_code` |
| `gateway` | Décision/condition | Aucune (les transitions gèrent les conditions) |
| `end` | Point de fin | `none`, `archive`, `notify`, `both` |

### Actions automatiques

- **`confirm_order`** : Confirme une commande de vente (`sale.order.action_confirm()`)
- **`create_invoice`** : Crée une facture pour une commande (`sale.order._create_invoices()`)
- **`create_delivery`** : Crée un bon de livraison
- **`validate_delivery`** : Valide un bon de livraison (`stock.picking.button_validate()`)
- **`custom_code`** : Exécute du code Python personnalisé (défini dans `action_code`)

## 🔧 Personnalisation

### Ajouter un nouveau processus

1. Créer un nouveau `bpm.process`
2. Définir le modèle cible (`model_id`)
3. Créer les nœuds dans l'onglet "Nœuds"
4. Créer les transitions dans l'onglet "Transitions"
5. Valider le workflow (bouton "Valider le Workflow")

### Modifier les conditions

Les conditions peuvent être modifiées dans l'onglet "Transitions" :
- Changer le type de condition
- Modifier le code Python
- Ajuster les valeurs de comparaison

### Ajouter des actions personnalisées

Dans un nœud de type `task` :
1. Sélectionner `auto_action = custom_code`
2. Remplir le champ `action_code` avec du code Python
3. Utiliser `record` pour accéder à l'enregistrement

Exemple :
```python
# Envoyer un message dans le chatter
record.message_post(body="Étape 'Vérification du stock' terminée")

# Modifier un champ
record.write({'state': 'in_progress'})
```

## 📝 Notes importantes

- **Un seul nœud START** : Le workflow doit avoir exactement un nœud de départ
- **Au moins un nœud END** : Le workflow doit avoir au moins un nœud de fin
- **Pas de boucles infinies** : Le système détecte les boucles et les empêche
- **Validation** : Utilisez le bouton "Valider le Workflow" pour vérifier la cohérence

## 🐛 Dépannage

### Le processus ne démarre pas
- Vérifier que `auto_start = True` si vous voulez un démarrage automatique
- Vérifier la condition de déclenchement (`trigger_condition`)
- Vérifier les droits d'accès sur le modèle

### Les transitions ne fonctionnent pas
- Vérifier que les conditions sont correctement écrites
- Vérifier que les champs référencés existent sur le modèle
- Consulter les logs Odoo pour voir les erreurs d'évaluation

### Les actions automatiques ne s'exécutent pas
- Vérifier que le modèle cible correspond à l'action (ex: `confirm_order` nécessite `sale.order`)
- Vérifier les droits d'accès
- Consulter les logs pour les erreurs Python

## 📚 Ressources

- Documentation Odoo : https://www.odoo.com/documentation/19.0/
- Code source : `addons/custom_bpm/`
- Exemple de données : `addons/custom_bpm/data/bpm_process_example.xml`

## 📄 Licence

LGPL-3
